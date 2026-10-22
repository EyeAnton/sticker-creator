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
mkjpg a; mkjpg b; mkjpg c; mkjpg d

DEV=smoke-device-$RANDOM$RANDOM$RANDOM
post() { # файл, эмоции, пол [, device] → тело в $TMP/out, код в stdout
  curl -s -o "$TMP/out" -w '%{http_code}' -H "Origin: $ORIGIN" \
    -F "photo=@$TMP/$1.jpg;type=image/jpeg" -F "emotions=$2" -F "gender=$3" -F "device=${4-$DEV}" -F "turnstile=XXXX.DUMMY.TOKEN.XXXX" "$BASE/api/jobs"
}

retry() { # jobId, стикер, причина → тело в $TMP/out, код в stdout
  curl -s -o "$TMP/out" -w '%{http_code}' -X POST -H "Origin: $ORIGIN" -H 'Content-Type: application/json' \
    -d "{\"reason\":\"$3\"}" "$BASE/api/jobs/$1/retry/$2"
}
sticker() { jget "[s['$2'] for s in d['stickers'] if s['id']=='$1'][0]" < "$TMP/${3-job}"; }

poll() { # jobId → ждём done/rejected/failed, печатаем смену этапа и попыток
  local last="" i
  for i in $(seq 1 60); do
    curl -s -H "Origin: $ORIGIN" "$BASE/api/jobs/$1" > "$TMP/job"
    local line; line=$(jget "d['stage']+' '+' '.join(s['id']+':'+s['state']+(('#'+str(s['attempt'])) if 'attempt' in s else '') for s in d['stickers'])" < "$TMP/job")
    [ "$line" != "$last" ] && echo "    $line" && last=$line
    [ -z "${T_EMO:-}" ] && case "$line" in emotions*) T_EMO=$(date +%s);; esac
    case $(jget "d['stage']" < "$TMP/job") in done|rejected|failed) return;; esac
    sleep 2
  done
}

echo "== config"
curl -s -H "Origin: $ORIGIN" "$BASE/api/config?device=$DEV" | tee "$TMP/cfg"; echo
check open True "$(jget "d['open']" < "$TMP/cfg")"
check canCreate True "$(jget "d['canCreate']" < "$TMP/cfg")"
check "эмоций в конфиге" 10 "$(jget "len(d['emotions'])" < "$TMP/cfg")"

echo "== origin / bad input"
check "неизвестная эмоция" 400 "$(post a nope '')"
check "POST без Origin" 403 "$(curl -s -o /dev/null -w '%{http_code}' -F photo=@$TMP/a.jpg -F emotions=wink -F turnstile=x "$BASE/api/jobs")"
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

echo "== пак 2: gender=stub-base-qa (QA базы бракует 1-ю генерацию) + wink + demon"
T0=$(date +%s)
check POST 201 "$(post b wink,demon stub-base-qa)"
J=$(jget "d['jobId']" < "$TMP/out")
check "параллельный пак → 429 busy" 429 "$(post c wink '')"
check error busy "$(jget "d['error']" < "$TMP/out")"
poll "$J"
check stage done "$(jget "d['stage']" < "$TMP/job")"
check "base" done "$(sticker base state)"
check "demon" done "$(sticker demon state)"
echo "    до этапа «эмоции»: $(( T_EMO - T0 )) с (validate 6 + restyle 6 + QA 6; повтор рестайла из-за QA добавляет 12)"
check "повтор рестайла из-за QA базы (≥ 27 с до эмоций)" 1 "$([ $(( T_EMO - T0 )) -ge 27 ] && echo 1 || echo 0)"

echo "== retry: брак эмоции из браузера"
check "base → 400" 400 "$(retry "$J" base leak)"
check "reason мусор → 400" 400 "$(retry "$J" wink bogus)"
check "нет такого стикера → 404" 404 "$(retry "$J" nope leak)"
check "без Origin → 403" 403 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -d '{"reason":"leak"}' "$BASE/api/jobs/$J/retry/wink")"
check "wink done → retry 200" 200 "$(retry "$J" wink leak)"
cp "$TMP/out" "$TMP/rj"
check "wink running" running "$(sticker wink state rj)"
check "wink попытка 2" 2 "$(sticker wink attempt rj)"
check "stage emotions" emotions "$(jget "d['stage']" < "$TMP/rj")"
check "wink running → retry 409" 409 "$(retry "$J" wink leak)"
poll "$J"
check "wink снова done" done "$(sticker wink state)"
check "stage done" done "$(jget "d['stage']" < "$TMP/job")"
check "retry → попытка 3" 3 "$(retry "$J" wink nobg >/dev/null; jget "d['stickers'][1]['attempt']" < "$TMP/out")"
poll "$J"
check "retry → попытка 4" 4 "$(retry "$J" wink leak >/dev/null; jget "d['stickers'][1]['attempt']" < "$TMP/out")"
poll "$J"
check "wink done на 4-й попытке" 4 "$(sticker wink attempt)"
check "5-я попытка → retry 200" 200 "$(retry "$J" wink leak)"
check "лимит 4 исчерпан → wink failed" failed "$(jget "d['stickers'][1]['state']" < "$TMP/out")"
check "stage done" done "$(jget "d['stage']" < "$TMP/out")"
curl -s -H "Origin: $ORIGIN" "$BASE/api/jobs/$J" > "$TMP/job"
check "wink failed после GET" failed "$(sticker wink state)"
check "failed → retry 409" 409 "$(retry "$J" wink leak)"
report() { # jobId, id, verdict → код
  curl -s -o "$TMP/out" -w '%{http_code}' -X POST -H "Origin: $ORIGIN" -H 'Content-Type: application/json' \
    -d "{\"id\":\"$2\",\"attempt\":1,\"verdict\":\"$3\",\"removed\":0.5,\"leak\":0}" "$BASE/api/jobs/$1/report"
}
echo "== report: итог заливки из браузера в журнал"
check "report ok" 200 "$(report "$J" wink ok)"
check "report мусорный verdict" 400 "$(report "$J" wink nonsense)"
check "report чужой стикер" 404 "$(report "$J" nope ok)"

echo "== картинка (стрим)"
curl -s -D "$TMP/hdr" -o "$TMP/img.png" -H "Origin: $ORIGIN" "$BASE/api/jobs/$J/img/demon"
check "Content-Type" image/png "$(grep -i '^content-type' "$TMP/hdr" | tr -d '\r' | awk '{print $2}')"
check "PNG-сигнатура" 89504e47 "$(head -c4 "$TMP/img.png" | xxd -p)"

echo "== пак 2 — тестовое подмножество эмоций (wink,demon → base + 2)"
check "стикеров в паке 2" 3 "$(jget "len(d['stickers'])" < "$TMP/job")"

echo "== новый пак с того же device и IP — можно (старый закончен)"
check POST 201 "$(post c wink '')"
J3=$(jget "d['jobId']" < "$TMP/out")
check "стикеров в паке 3" 2 "$(jget "len(d['stickers'])" < "$TMP/out")"
check "пока идёт — второй с того же device → 429 busy" 429 "$(post d wink '')"
check error busy "$(jget "d['error']" < "$TMP/out")"
curl -s -H "Origin: $ORIGIN" "$BASE/api/config?device=$DEV" > "$TMP/cfg"
check "canCreate пока идёт пак" False "$(jget "d['canCreate']" < "$TMP/cfg")"
check reason busy "$(jget "d['reason']" < "$TMP/cfg")"
poll "$J3"
check "пак 3 done" done "$(jget "d['stage']" < "$TMP/job")"
curl -s -H "Origin: $ORIGIN" "$BASE/api/config?device=$DEV" > "$TMP/cfg"
check "canCreate после пака" True "$(jget "d['canCreate']" < "$TMP/cfg")"

rm -rf "$TMP"
echo; [ $FAILS -eq 0 ] && echo "SMOKE OK" || { echo "SMOKE: провалов $FAILS"; exit 1; }
