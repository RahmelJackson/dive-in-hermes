"""Bounded public feed retrieval and evidence normalization."""
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from hashlib import sha256
from html.parser import HTMLParser
import http.client
import ipaddress
import re
import socket
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit
import xml.etree.ElementTree as ET

MAX_BYTES = 2_000_000
TRACKERS = {"fbclid", "gclid", "mc_cid", "mc_eid"}


def url(value, canonical=False):
    if len(value) > 2048 or any(ord(c) <= 32 or c == "\\" for c in value):
        raise ValueError("Invalid URL")
    parts = urlsplit(value)
    if parts.scheme not in {"http", "https"} or not parts.hostname or parts.username is not None:
        raise ValueError("Use an absolute HTTP(S) URL without credentials")
    host = parts.hostname.encode("idna").decode().lower()
    port = parts.port
    authority = f"[{host}]" if ":" in host else host
    if port and port != {"http": 80, "https": 443}[parts.scheme]:
        authority += f":{port}"
    query = parts.query
    if canonical:
        query = urlencode([(k, v) for k, v in parse_qsl(query, keep_blank_values=True)
                           if not k.lower().startswith("utm_") and k.lower() not in TRACKERS])
    return urlunsplit((parts.scheme, authority, parts.path or "/", query, ""))


def fetch(feed_url):
    parts = urlsplit(url(feed_url))
    if parts.scheme != "https" or parts.port is not None:
        raise ValueError("Feed retrieval requires HTTPS on port 443")
    addresses = socket.getaddrinfo(parts.hostname, 443, type=socket.SOCK_STREAM)
    for _, _, _, _, address in addresses:
        ip = ipaddress.ip_address(address[0])
        if not ip.is_global or ip.is_multicast:
            raise ValueError("Feed must resolve exclusively to public unicast addresses")
    # Connect to the validated IP while retaining the original TLS hostname.
    conn = http.client.HTTPSConnection(parts.hostname, timeout=8)
    conn._create_connection = lambda _, timeout, source: socket.create_connection(
        (addresses[0][4][0], 443), timeout, source)
    try:
        target = urlunsplit(("", "", parts.path, parts.query, ""))
        conn.request("GET", target, headers={
            "User-Agent": "SignalAtlas/0.1", "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml",
            "Accept-Encoding": "identity",
        })
        response = conn.getresponse()
        if response.status != 200:
            raise ValueError(f"Feed returned HTTP {response.status}; use the final public feed URL")
        if response.getheader("Content-Encoding", "identity").lower() != "identity":
            raise ValueError("Compressed feed response is unsupported")
        body = response.read(MAX_BYTES + 1)
        if len(body) > MAX_BYTES:
            raise ValueError("Feed exceeds 2 MB")
        return body
    finally:
        conn.close()


def utc(value):
    return value.astimezone(timezone.utc).isoformat(timespec="microseconds")


def timestamp(raw):
    if not raw:
        return None, "missing"
    for parse in (datetime.fromisoformat, parsedate_to_datetime):
        try:
            value = parse(raw)
            return (utc(value), "normalized") if value.utcoffset() is not None else (None, "timezone_missing")
        except (ValueError, OverflowError, TypeError):
            continue
    return None, "invalid"


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)


def plain(value, limit):
    parser = PlainText()
    parser.feed(value)
    parser.close()
    return " ".join(" ".join(parser.parts).split())[:limit]


def parse_feed(body, source):
    if len(body) > MAX_BYTES:
        raise ValueError("Feed exceeds 2 MB")
    xml = body.decode("utf-8-sig")
    if re.search(r"<!\s*(DOCTYPE|ENTITY)\b", xml, re.I):
        raise ValueError("DTD and entities are unsupported")
    root = ET.fromstring(xml)
    atom = root.tag == "{http://www.w3.org/2005/Atom}feed"
    if not atom and (root.tag != "rss" or root.find("channel") is None):
        raise ValueError("Expected an RSS 2.0 or Atom feed")
    ns = "{http://www.w3.org/2005/Atom}" if atom else ""
    entries = root.findall(ns + "entry") if atom else root.findall("channel/item")
    result = []
    for entry in entries[:250]:
        def field(name):
            node = entry.find(ns + name)
            return "".join(node.itertext()).strip() if node is not None else ""

        link = field("link")
        if atom:
            link = next((node.get("href", "") for node in entry.findall(ns + "link")
                         if node.get("rel", "alternate") == "alternate"), "")
        if not link:
            continue
        try:
            article = url(urljoin(source, link), canonical=True)
        except ValueError:
            continue
        title = plain(field("title"), 300)
        excerpt = plain(field("summary") or field("content") if atom else field("description"), 1200)
        date_field = next((name for name in (("published", "updated") if atom else ("pubDate",))
                           if field(name)), None)
        raw = field(date_field)[:256] if date_field else None
        published, status = timestamp(raw)
        result.append(dict(article_url=article, title=title, excerpt=excerpt, date_field=date_field,
                           date_raw=raw, date_utc=published, date_status=status,
                           entry_key=field("id" if atom else "guid")[:512]))
    return result


def digest(*values):
    import json
    return sha256(json.dumps(values, ensure_ascii=True, sort_keys=True).encode()).hexdigest()

