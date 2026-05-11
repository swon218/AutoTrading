"""
Kiwoom REST API quick checker.

1) 아래 APPKEY / SECRETKEY에 키움 REST API 키를 넣습니다.
2) 실행합니다.

    python fast.py

기본 실행은 다음을 모두 수행합니다.
- 키움 REST API로 받을 수 있는 주요 정보 종류 출력
- APPKEY / SECRETKEY가 입력되어 있으면 토큰 발급
- 계좌번호조회 + 삼성전자 주식기본정보 샘플 호출

주의:
- 주문 TR은 실제 주문이 나갈 수 있으므로 이 파일에서는 호출하지 않고 목록만 보여줍니다.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any


# 실제 키는 .env의 KIWOOM_APPKEY / KIWOOM_SECRETKEY에서 읽습니다.
APPKEY = ""
SECRETKEY = ""



REAL_HOST = "https://api.kiwoom.com"


@dataclass(frozen=True)
class ApiExample:
    category: str
    name: str
    api_id: str
    endpoint: str
    body: dict[str, Any]
    note: str = ""


CATALOG: dict[str, list[tuple[str, str]]] = {
    "OAuth 인증": [
        ("au10001", "접근토큰 발급"),
        ("au10002", "접근토큰 폐기"),
    ],
    "계좌": [
        ("ka00001", "계좌번호조회"),
        ("kt00001", "예수금상세현황요청"),
        ("kt00004", "계좌평가현황요청"),
        ("kt00018", "계좌평가잔고내역요청"),
        ("ka10075", "미체결요청"),
        ("ka10076", "체결요청"),
    ],
    "종목정보": [
        ("ka10001", "주식기본정보요청"),
        ("ka10099", "종목정보 리스트"),
        ("ka10100", "종목정보 조회"),
        ("ka10101", "업종코드 리스트"),
        ("ka10102", "회원사 리스트"),
    ],
    "시세": [
        ("ka10004", "주식호가요청"),
        ("ka10005", "주식일주월시분요청"),
        ("ka10006", "주식시분요청"),
        ("ka10086", "일별주가요청"),
        ("ka10087", "시간외단일가요청"),
    ],
    "차트": [
        ("ka10079", "주식틱차트조회요청"),
        ("ka10080", "주식분봉차트조회요청"),
        ("ka10081", "주식일봉차트조회요청"),
        ("ka10082", "주식주봉차트조회요청"),
        ("ka10083", "주식월봉차트조회요청"),
        ("ka10094", "주식년봉차트조회요청"),
    ],
    "순위정보": [
        ("ka10020", "호가잔량상위요청"),
        ("ka10023", "거래량급증요청"),
        ("ka10027", "전일대비등락률상위요청"),
        ("ka10030", "당일거래량상위요청"),
        ("ka10032", "거래대금상위요청"),
    ],
    "기관/외국인": [
        ("ka10008", "주식외국인종목별매매동향"),
        ("ka10009", "주식기관요청"),
        ("ka10131", "기관외국인연속매매현황요청"),
    ],
    "조건검색": [
        ("ka10171", "조건검색 목록조회"),
        ("ka10172", "조건검색 요청 일반"),
        ("ka10173", "조건검색 요청 실시간"),
        ("ka10174", "조건검색 실시간 해제"),
    ],
    "주문": [
        ("kt10000", "주식 매수주문"),
        ("kt10001", "주식 매도주문"),
        ("kt10002", "주식 정정주문"),
        ("kt10003", "주식 취소주문"),
    ],
    "기타": [
        ("공매도", "공매도추이"),
        ("대차거래", "대차거래추이/상위종목"),
        ("업종", "업종현재가/업종별주가"),
        ("테마", "테마그룹/구성종목"),
        ("ELW", "ELW 민감도/괴리율/순위"),
        ("ETF", "ETF 수익률/종목정보/전체시세"),
        ("실시간", "주식체결/호가잔량/잔고/VI발동 등"),
    ],
}


SAMPLE_APIS: list[ApiExample] = [
    ApiExample(
        category="계좌",
        name="계좌번호조회",
        api_id="ka00001",
        endpoint="/api/dostk/acnt",
        body={},
        note="현재 토큰에 연결된 계좌번호를 조회합니다.",
    ),
    ApiExample(
        category="종목정보",
        name="주식기본정보요청",
        api_id="ka10001",
        endpoint="/api/dostk/stkinfo",
        body={"stk_cd": "005930"},
        note="삼성전자 기본정보를 조회합니다.",
    ),
]


def request_json(
    method: str,
    url: str,
    headers: dict[str, str],
    body: dict[str, Any] | None = None,
    timeout: int = 20,
) -> tuple[int, dict[str, str], Any]:
    data = None
    if body is not None:
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")

    req = urllib.request.Request(url=url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            text = response.read().decode("utf-8")
            return response.status, dict(response.headers), json.loads(text or "{}")
    except urllib.error.HTTPError as err:
        text = err.read().decode("utf-8", errors="replace")
        try:
            parsed: Any = json.loads(text)
        except json.JSONDecodeError:
            parsed = {"raw": text}
        return err.code, dict(err.headers), parsed


def issue_token(host: str, appkey: str, secretkey: str) -> str:
    status, _, payload = request_json(
        "POST",
        f"{host}/oauth2/token",
        {"Content-Type": "application/json;charset=UTF-8"},
        {
            "grant_type": "client_credentials",
            "appkey": appkey,
            "secretkey": secretkey,
        },
    )

    if status != 200 or not isinstance(payload, dict) or not payload.get("token"):
        raise RuntimeError(f"토큰 발급 실패(status={status}): {payload}")

    print(f"\n[OK] 토큰 발급 완료: expires_dt={payload.get('expires_dt')}")
    return str(payload["token"])


def call_kiwoom_api(host: str, token: str, api: ApiExample) -> tuple[int, dict[str, str], Any]:
    headers = {
        "Content-Type": "application/json;charset=UTF-8",
        "authorization": f"Bearer {token}",
        "cont-yn": "N",
        "next-key": "",
        "api-id": api.api_id,
    }
    return request_json("POST", f"{host}{api.endpoint}", headers, api.body)


def print_catalog() -> None:
    print("키움증권 REST API로 받을 수 있는 주요 정보")
    print("=" * 52)
    for category, items in CATALOG.items():
        print(f"\n[{category}]")
        for api_id, name in items:
            print(f"  - {api_id}: {name}")


def print_probe_result(api: ApiExample, status: int, headers: dict[str, str], payload: Any) -> None:
    print(f"\n[{api.category}] {api.name} ({api.api_id})")
    print(f"endpoint: {api.endpoint}")
    print(f"note: {api.note}")
    print(f"status: {status}")
    print(f"cont-yn: {headers.get('cont-yn', '')}, next-key: {headers.get('next-key', '')}")
    print("response:")
    print(json.dumps(payload, ensure_ascii=False, indent=2)[:4000])


def run_probe(host: str, token: str) -> None:
    for api in SAMPLE_APIS:
        status, headers, payload = call_kiwoom_api(host, token, api)
        print_probe_result(api, status, headers, payload)


def load_dotenv(path: str = ".env") -> None:
    if not os.path.exists(path):
        return

    with open(path, "r", encoding="utf-8") as file:
        for line in file:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue

            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip("\"'")
            if key and key not in os.environ:
                os.environ[key] = value


def get_key(name: str, code_value: str) -> str:
    return code_value.strip() or os.getenv(name, "").strip()


def main() -> int:
    print_catalog()
    load_dotenv()

    appkey = get_key("KIWOOM_APPKEY", APPKEY)
    secretkey = get_key("KIWOOM_SECRETKEY", SECRETKEY)

    if not appkey or not secretkey:
        print("\nAPPKEY / SECRETKEY가 비어 있어 실제 API 호출은 건너뜁니다.")
        print(".env에 KIWOOM_APPKEY, KIWOOM_SECRETKEY를 넣고 다시 실행하면 샘플 데이터를 받아옵니다.")
        return 0

    host = REAL_HOST
    token = issue_token(host, appkey, secretkey)
    run_probe(host, token)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"\n[ERROR] {exc}", file=sys.stderr)
        raise SystemExit(1)
