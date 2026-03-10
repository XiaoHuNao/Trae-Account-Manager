import random
import re
import string
from abc import ABC, abstractmethod
from html import unescape

import httpx


class TempMailProvider(ABC):
    def __init__(self, client):
        self.client = client
        self.authorization_headers = {}
        self.seen_message_ids = set()

    @property
    @abstractmethod
    def name(self):
        raise NotImplementedError

    @abstractmethod
    async def start(self):
        raise NotImplementedError

    @abstractmethod
    async def create_mailbox(self):
        raise NotImplementedError

    @abstractmethod
    async def fetch_latest_message_text(self, email_address):
        raise NotImplementedError


class MailTmProvider(TempMailProvider):
    def __init__(self, client):
        super().__init__(client)
        self.base_url = "https://api.mail.tm"
        self.domains = []
        self.password = None

    @property
    def name(self):
        return "mailtm"

    async def start(self):
        self.domains = await self._fetch_domains()
        if not self.domains:
            raise RuntimeError(f"{self.name} 未返回可用域名")

    async def _fetch_domains(self):
        response = await self.client.get(f"{self.base_url}/domains")
        response.raise_for_status()
        data = response.json()
        domains = []
        if isinstance(data, dict):
            candidates = data.get("hydra:member") or data.get("domains") or []
        elif isinstance(data, list):
            candidates = data
        else:
            candidates = []
        for item in candidates:
            if not isinstance(item, dict):
                continue
            domain = item.get("domain")
            is_active = item.get("isActive", True)
            if domain and is_active:
                domains.append(domain)
        return domains

    async def create_mailbox(self):
        if not self.domains:
            await self.start()
        for _ in range(6):
            username = "".join(random.choices(string.ascii_lowercase + string.digits, k=10))
            domain = random.choice(self.domains)
            email = f"{username}@{domain}"
            password = "".join(random.choices(string.ascii_letters + string.digits, k=16))
            account_response = await self.client.post(
                f"{self.base_url}/accounts",
                json={"address": email, "password": password},
            )
            if account_response.status_code not in (200, 201):
                continue
            token_response = await self.client.post(
                f"{self.base_url}/token",
                json={"address": email, "password": password},
            )
            if token_response.status_code not in (200, 201):
                continue
            token_data = token_response.json()
            token = token_data.get("token") if isinstance(token_data, dict) else None
            if not token:
                continue
            self.authorization_headers = {"Authorization": f"Bearer {token}"}
            self.password = password
            return email
        raise RuntimeError(f"{self.name} 创建邮箱失败")

    async def fetch_latest_message_text(self, email_address):
        _ = email_address
        messages_response = await self.client.get(
            f"{self.base_url}/messages",
            headers=self.authorization_headers,
        )
        if messages_response.status_code != 200:
            return None
        messages_data = messages_response.json()
        if isinstance(messages_data, dict):
            messages = messages_data.get("hydra:member") or messages_data.get("messages") or []
        elif isinstance(messages_data, list):
            messages = messages_data
        else:
            messages = []
        if not messages:
            return None
        latest = messages[0] if isinstance(messages[0], dict) else None
        if not latest:
            return None
        message_id = latest.get("id")
        if not message_id or message_id in self.seen_message_ids:
            return None
        detail_response = await self.client.get(
            f"{self.base_url}/messages/{message_id}",
            headers=self.authorization_headers,
        )
        if detail_response.status_code != 200:
            return None
        detail = detail_response.json()
        self.seen_message_ids.add(message_id)
        if not isinstance(detail, dict):
            return None
        return {
            "text": detail.get("text"),
            "intro": detail.get("intro"),
            "html": detail.get("html"),
            "subject": latest.get("subject"),
        }


class AsyncMailClient:
    def __init__(self):
        self.client = None
        self.email_address = None
        self.last_verification_code = None
        self.provider = None

    async def start(self):
        self.client = httpx.AsyncClient(
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            },
            timeout=30.0,
        )
        self.provider = MailTmProvider(self.client)
        await self.provider.start()
        self.email_address = await self.provider.create_mailbox()
        print(f"已启用邮箱服务商：{self.provider.name}")
        print(f"已生成邮箱：{self.email_address}")

    def get_email(self):
        if not self.email_address:
            raise RuntimeError("邮箱未初始化")
        return self.email_address

    async def check_emails(self):
        if not self.provider or not self.email_address:
            return
        try:
            content = await self.provider.fetch_latest_message_text(self.email_address)
            if content:
                self._parse_verification_code(content)
        except Exception as error:
            print(f"邮箱检查异常：{error}")

    def _parse_verification_code(self, content):
        fields = []
        raw_html = None
        if isinstance(content, dict):
            raw_html = content.get("html")
            fields.extend(
                [
                    content.get("text"),
                    content.get("intro"),
                    content.get("subject"),
                    raw_html,
                ]
            )
        else:
            fields.append(content)
        if raw_html:
            html_code = self._extract_code_from_html_raw(raw_html)
            if html_code:
                self.last_verification_code = html_code
                print(f"已找到验证码：{self.last_verification_code}")
                return
        for item in fields:
            code = self._extract_code_from_text(item)
            if code:
                self.last_verification_code = code
                print(f"已找到验证码：{self.last_verification_code}")
                return

    def _extract_code_from_html_raw(self, html_text):
        if not html_text:
            return None
        matches = re.findall(r">\s*(\d{6})\s*<", str(html_text))
        if matches:
            return matches[0]
        return None

    def _extract_code_from_text(self, text):
        if not text:
            return None
        content = unescape(str(text))
        content = re.sub(r"<[^>]+>", " ", content)
        content = re.sub(r"\s+", " ", content)
        keyword_patterns = [
            r"(?:verification\s*code|verify\s*code|code|验证码|驗證碼)[^\d]{0,24}(\d{6})",
            r"(\d{6})[^\d]{0,24}(?:verification\s*code|verify\s*code|code|验证码|驗證碼)",
        ]
        for pattern in keyword_patterns:
            match = re.search(pattern, content, re.IGNORECASE)
            if match:
                return match.group(1)
        generic_matches = []
        for match in re.finditer(r"\b(\d{6})\b", content):
            start = match.start(1)
            if start > 0 and content[start - 1] == "#":
                continue
            generic_matches.append(match.group(1))
        if generic_matches:
            return generic_matches[0]
        return None

    async def close(self):
        if self.client:
            await self.client.aclose()
