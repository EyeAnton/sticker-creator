#!/usr/bin/env bash
# Smoke-тест Worker'а в stub-режиме. Нужен чистый KV (иначе лимиты по IP не сойдутся):
#   rm -rf .wrangler/state && npx wrangler dev        (в другом терминале)
#   ./smoke.sh [http://localhost:8787]
set -u
BASE=${1:-http://localhost:8787}
ORIGIN=http://localhost:8000
TMP=$(mktemp -d)
FAILS=0

py() { python3 -I -c "$@"; }
jget() { py "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1]))" "$1"; }
check() { # описание, ожидаемое, фактическое
  if [ "$2" = "$3" ]; then echo "  ok   $1 = $3"; else echo "  FAIL $1: ожидали '$2', получили '$3'"; FAILS=$((FAILS+1)); fi
}

# «JPEG»: правильные первые байты FF D8 FF, Worker картинки не декодирует; суффикс делает файлы разными
mkjpg() { printf '\xff\xd8\xff\xe0smoke-%s\xff\xd9' "$1" > "$TMP/$1.jpg"; }
mkjpg a; mkjpg b; mkjpg c

DEV=smoke-device-$RANDOM$RANDOM$RANDOM
post() { # файл, эмоции, пол [, device] → тело в $TMP/out, код в stdout
  curl -s -o "$TMP/out" -w '%{http_code}' -H "Origin: $ORIGIN" \
    -F "photo=@$TMP/$1.jpg;type=image/jpeg" -F "emotions=$2" -F "gender=$3" -F "device=${4-$DEV}" -F "turnstile=XXXX.DUMMY.TOKEN.XXXX" "$BASE/api/jobs"
}

poll() { # jobId → ждём done/rejected/failed, печатаем смену этапа и попыток
  local last="" i
  for i in $(seq 1 60); do
    curl -s -H "Origin: $ORIGIN" "$BASE/api/jobs/$1" > "$TMP/job"
    local line; line=$(jget "d['stage']+' '+' '.join(s['id']+':'+s['state']+(('#'+str(s['attempt'])) if 'attempt' in s else '') for s in d['stickers'])" < "$TMP/job")
    [ "$line" != "$last" ] && echo "    $line" && last=$line
    case $(jget "d['stage']" < "$TMP/job") in done|rejected|failed) return;; esac
    sleep 2
  done
}

echo "== config"
curl -s -H "Origin: $ORIGIN" "$BASE/api/config?device=$DEV" | tee "$TMP/cfg"; echo
check open True "$(jget "d['open']" < "$TMP/cfg")"
check canCreate True "$(jget "d['canCreate']" < "$TMP/cfg")"
check maxEmotions 10 "$(jget "d['maxEmotions']" < "$TMP/cfg")"

echo "== origin / bad input"
check "POST без Origin" 403 "$(curl -s -o /dev/null -w '%{http_code}' -F photo=@$TMP/a.jpg -F emotions=wink -F turnstile=x "$BASE/api/jobs")"
check "неизвестная эмоция" 400 "$(post a nope '')"
check "без device" 400 "$(post a wink '' '')"

echo "== пак 1: gender=stub-reject → rejected"
check POST 201 "$(post a wink stub-reject)"
J=$(jget "d['jobId']" < "$TMP/out")
poll "$J"
check stage rejected "$(jget "d['stage']" < "$TMP/job")"
echo "    message: $(jget "d['message']" < "$TMP/job")"

echo "== повтор того же фото → 422"
check POST 422 "$(post a wink '')"
cat "$TMP/out"; echo

echo "== после rejected устройство снова может"
curl -s -H "Origin: $ORIGIN" "$BASE/api/config?device=$DEV" > "$TMP/cfg"
check canCreate True "$(jget "d['canCreate']" < "$TMP/cfg")"

echo "== пак 2: wink + demon → demon на 3-й попытке, done"
check POST 201 "$(post b wink,demon '')"
J=$(jget "d['jobId']" < "$TMP/out")
check "параллельный пак → 429 busy" 429 "$(post c wink '')"
check error busy "$(jget "d['error']" < "$TMP/out")"
poll "$J"
check stage done "$(jget "d['stage']" < "$TMP/job")"
check "base" done "$(jget "[s['state'] for s in d['stickers'] if s['id']=='base'][0]" < "$TMP/job")"
check "demon" done "$(jget "[s['state'] for s in d['stickers'] if s['id']=='demon'][0]" < "$TMP/job")"
echo "== картинка (стрим)"
curl -s -D "$TMP/hdr" -o "$TMP/img.png" -H "Origin: $ORIGIN" "$BASE/api/jobs/$J/img/demon"
check "Content-Type" image/png "$(grep -i '^content-type' "$TMP/hdr" | tr -d '\r' | awk '{print $2}')"
check "PNG-сигнатура" 89504e47 "$(head -c4 "$TMP/img.png" | xxd -p)"

echo "== второй пак с того же device → 429 limit"
check POST 429 "$(post c wink '')"
check error limit "$(jget "d['error']" < "$TMP/out")"
cat "$TMP/out"; echo
curl -s -H "Origin: $ORIGIN" "$BASE/api/config?device=$DEV" > "$TMP/cfg"
check canCreate False "$(jget "d['canCreate']" < "$TMP/cfg")"
echo "== другой device с того же IP → 429 (страховка по IP)"
check POST 429 "$(post c wink '' other-device-$RANDOM$RANDOM$RANDOM)"

rm -rf "$TMP"
echo; [ $FAILS -eq 0 ] && echo "SMOKE OK" || { echo "SMOKE: провалов $FAILS"; exit 1; }
