"""Safe Uqload URL validation and Dean Edwards packer decoding."""

from __future__ import annotations

import re
from urllib.parse import urljoin, urlparse


# Uqload fait tourner son domaine (.is, .bz, .cx, .vc, …) et les anciens
# miroirs redirigent en 301 vers le domaine actif. Une énumération figée
# cassait l'extraction à chaque rotation, donc on valide le domaine
# enregistrable `uqload.<tld>`. La garde SSRF reste équivalente : seul un
# hôte dont les deux derniers labels forment `uqload.<tld>` est accepté.
UQLOAD_ROOT_RE = re.compile(r"^uqload\.[a-z]{2,24}$")

PACKER_SIGNATURE_RE = re.compile(
    r"eval\s*\(\s*function\s*\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,"
    r"\s*e\s*,\s*d\s*\)"
)
PACKER_SINGLE_QUOTE_RE = re.compile(
    r"\}\s*\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,"
    r"\s*'((?:[^'\\]|\\.)*)'\s*\.split",
    re.DOTALL,
)
PACKER_DOUBLE_QUOTE_RE = re.compile(
    r'\}\s*\(\s*"((?:[^"\\]|\\.)*)"\s*,\s*(\d+)\s*,\s*(\d+)\s*,'
    r'\s*"((?:[^"\\]|\\.)*)"\s*\.split',
    re.DOTALL,
)
HTTPS_URL_RE = re.compile(r"""https://[^\s"'\\<>]+""", re.IGNORECASE)
VIDEO_ID_RE = re.compile(r"^[a-z0-9_-]+$", re.IGNORECASE)


def get_uqload_root_domain(hostname: str | None) -> str | None:
    host = str(hostname or "").lower().rstrip(".")
    labels = host.split(".")
    if len(labels) < 2:
        return None
    root = ".".join(labels[-2:])
    return root if UQLOAD_ROOT_RE.fullmatch(root) else None


def parse_allowed_uqload_url(raw_url: str):
    try:
        parsed = urlparse(str(raw_url or "").strip())
        port = parsed.port
    except (TypeError, ValueError):
        raise ValueError("Invalid Uqload URL") from None

    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or (port is not None and port != 443)
        or not get_uqload_root_domain(parsed.hostname)
    ):
        raise ValueError("Invalid Uqload URL")
    return parsed


def normalize_uqload_embed_url(raw_url: str) -> str:
    parsed = parse_allowed_uqload_url(raw_url)
    last_part = next(
        (part for part in reversed(parsed.path.split("/")) if part),
        "",
    )
    video_id = re.sub(r"^embed-", "", last_part, flags=re.IGNORECASE)
    video_id = re.sub(r"\.html$", "", video_id, flags=re.IGNORECASE)
    if not VIDEO_ID_RE.fullmatch(video_id):
        raise ValueError("Invalid Uqload URL")

    authority = parsed.hostname
    if parsed.port:
        authority = f"{authority}:{parsed.port}"
    return f"https://{authority}/embed-{video_id}.html"


def get_uqload_site_origin(raw_url: str) -> str:
    parsed = parse_allowed_uqload_url(raw_url)
    return f"https://{get_uqload_root_domain(parsed.hostname)}"


def _number_to_base(number: int, radix: int) -> str:
    quotient, remainder = divmod(number, radix)
    if remainder > 35:
        digit = chr(remainder + 29)
    else:
        digit = "0123456789abcdefghijklmnopqrstuvwxyz"[remainder]
    return (_number_to_base(quotient, radix) if quotient else "") + digit


def unpack_dean_edwards(
    packed_script: str,
    radix: int,
    keyword_count: int,
    keywords: list[str],
) -> str:
    if (
        radix < 2
        or radix > 62
        or keyword_count < 0
        or keyword_count > 10_000
        or keyword_count > len(keywords)
    ):
        raise ValueError("Invalid packed script")

    lookup = {}
    for index in range(keyword_count - 1, -1, -1):
        token = _number_to_base(index, radix)
        lookup[token] = keywords[index] if index < len(keywords) and keywords[index] else token

    return re.sub(
        r"\b\w+\b",
        lambda match: lookup.get(match.group(0), match.group(0)),
        packed_script,
    )


def decode_packed_script_from_html(html: str) -> str | None:
    content = str(html or "")
    signature = PACKER_SIGNATURE_RE.search(content)
    if not signature:
        return None

    split_match = re.search(r"""\.split\s*\(\s*(['"])\|\1\s*\)""", content[signature.start() :])
    if not split_match:
        return None
    split_end = signature.start() + split_match.end()
    section = content[signature.start() : split_end]

    match = PACKER_SINGLE_QUOTE_RE.search(section) or PACKER_DOUBLE_QUOTE_RE.search(section)
    if not match:
        return None

    payload = match.group(1).replace("\\'", "'").replace('\\"', '"')
    radix = int(match.group(2))
    keyword_count = int(match.group(3))
    keywords = match.group(4).split("|")
    try:
        return unpack_dean_edwards(payload, radix, keyword_count, keywords)
    except ValueError:
        return None


UQLOAD_SUBTITLE_LANGS = (
    ("fr", re.compile(r"\b(?:fr|fra|fre|french|fran[cç]ais|vf|vostfr)\b", re.IGNORECASE)),
    ("en", re.compile(r"\b(?:en|eng|english|anglais)\b", re.IGNORECASE)),
    ("es", re.compile(r"\b(?:es|spa|spanish|espa[nñ]ol)\b", re.IGNORECASE)),
    ("de", re.compile(r"\b(?:de|ger|deu|german|deutsch)\b", re.IGNORECASE)),
    ("it", re.compile(r"\b(?:it|ita|italian|italiano)\b", re.IGNORECASE)),
    ("pt", re.compile(r"\b(?:pt|por|portuguese|portugu[eê]s)\b", re.IGNORECASE)),
    ("ar", re.compile(r"\b(?:ar|ara|arabic|arabe)\b", re.IGNORECASE)),
)
TRACKS_BLOCK_RE = re.compile(r"tracks\s*:\s*\[([\s\S]{0,8000}?)\]")
TRACK_ENTRY_RE = re.compile(r"\{[^{}]*\}")
SUBTITLE_FILE_RE = re.compile(r"\.(?:vtt|srt)(?:[?#]|$)", re.IGNORECASE)
EMPTY_SUBTITLE_RE = re.compile(r"/empty\.(?:srt|vtt)(?:[?#]|$)", re.IGNORECASE)
TRACK_DEFAULT_RE = re.compile(r"""["']?default["']?\s*:\s*(?:true|["']true["'])""", re.IGNORECASE)


def _track_field(entry: str, name: str) -> str:
    match = re.search(rf"""["']?{name}["']?\s*:\s*["']([^"']*)["']""", entry, re.IGNORECASE)
    return match.group(1).strip() if match else ""


def _guess_subtitle_lang(label: str, url: str) -> str:
    file_name = url.split("?")[0].split("#")[0].rsplit("/", 1)[-1]
    haystack = f"{label} {re.sub(r'[_.-]', ' ', file_name)}"
    for code, pattern in UQLOAD_SUBTITLE_LANGS:
        if pattern.search(haystack):
            return code
    return "und"


def extract_uqload_subtitles(html: str, page_url: str) -> list[dict]:
    """Sous-titres de `jwplayer().setup({ tracks })`.

    Ignore les vignettes (`kind: "thumbnails"`) et le `empty.srt` factice
    qu'Uqload ajoute sous « Upload captions ». Même logique que l'extension.
    """
    sources = [str(html or "")]
    decoded = decode_packed_script_from_html(html)
    if decoded:
        sources.append(decoded)

    subtitles: list[dict] = []
    seen: set[str] = set()
    for source in sources:
        normalized = source.replace("\\/", "/")
        for block in TRACKS_BLOCK_RE.finditer(normalized):
            for entry_match in TRACK_ENTRY_RE.finditer(block.group(1)):
                entry = entry_match.group(0)
                file_ref = _track_field(entry, "file") or _track_field(entry, "src")
                kind = (_track_field(entry, "kind") or "captions").lower()
                if not file_ref or kind not in ("captions", "subtitles"):
                    continue
                if EMPTY_SUBTITLE_RE.search(file_ref) or not SUBTITLE_FILE_RE.search(file_ref):
                    continue
                try:
                    url = parse_allowed_uqload_url(urljoin(page_url, file_ref)).geturl()
                except ValueError:
                    continue
                if url in seen:
                    continue
                seen.add(url)

                label = _track_field(entry, "label")
                lang = _guess_subtitle_lang(label, url)
                subtitles.append({
                    "url": url,
                    "label": label or (lang.upper() if lang != "und" else f"Piste {len(subtitles) + 1}"),
                    "lang": lang,
                    "format": "srt" if re.search(r"\.srt(?:[?#]|$)", url, re.IGNORECASE) else "vtt",
                    "default": bool(TRACK_DEFAULT_RE.search(entry)),
                })
                if len(subtitles) >= 8:
                    return subtitles
    return subtitles


def extract_uqload_media_url(html: str) -> str | None:
    candidates: list[str] = []

    def collect(value: str | None) -> None:
        normalized = str(value or "").replace("\\/", "/")
        for match in HTTPS_URL_RE.finditer(normalized):
            candidate = match.group(0).rstrip("),;")
            try:
                parse_allowed_uqload_url(candidate)
            except ValueError:
                continue
            candidates.append(candidate)

    collect(html)
    collect(decode_packed_script_from_html(html))

    for pattern in (
        re.compile(r"/master\.m3u8(?:[?#]|$)", re.IGNORECASE),
        re.compile(r"\.m3u8(?:[?#]|$)", re.IGNORECASE),
        re.compile(r"/v\.mp4(?:[?#]|$)", re.IGNORECASE),
    ):
        match = next((url for url in candidates if pattern.search(url)), None)
        if match:
            return match
    return None
