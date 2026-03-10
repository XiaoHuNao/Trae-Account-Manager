import asyncio
import random
import string
import os
import re
import json
import sys
from playwright.async_api import async_playwright
from mail_client import AsyncMailClient

# Setup directories
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
COOKIES_DIR = os.path.join(BASE_DIR, "cookies")
ACCOUNTS_FILE = os.path.join(BASE_DIR, "accounts.txt")
os.makedirs(COOKIES_DIR, exist_ok=True)

def generate_password(length=12):
    chars = string.ascii_letters + string.digits + "!@#$%^&*"
    return ''.join(random.choices(chars, k=length))

def build_random_fingerprint():
    browser_profiles = [
        {
            "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
            "platform": "Win32",
            "accept_language": "en-US,en;q=0.9",
        },
        {
            "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "platform": "Win32",
            "accept_language": "en-GB,en;q=0.9",
        },
        {
            "user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
            "platform": "MacIntel",
            "accept_language": "en-US,en;q=0.9",
        },
    ]
    viewport = random.choice(
        [
            {"width": 1366, "height": 768},
            {"width": 1440, "height": 900},
            {"width": 1536, "height": 864},
            {"width": 1600, "height": 900},
            {"width": 1920, "height": 1080},
        ]
    )
    locale_timezone_pairs = [
        ("en-US", "America/New_York"),
        ("en-US", "America/Los_Angeles"),
        ("en-GB", "Europe/London"),
        ("en-SG", "Asia/Singapore"),
    ]
    locale, timezone_id = random.choice(locale_timezone_pairs)
    profile = random.choice(browser_profiles)
    return {
        "user_agent": profile["user_agent"],
        "platform": profile["platform"],
        "viewport": viewport,
        "locale": locale,
        "timezone_id": timezone_id,
        "color_scheme": random.choice(["light", "dark"]),
        "device_scale_factor": random.choice([1, 1.25, 1.5, 2]),
        "has_touch": random.random() < 0.15,
        "hardware_concurrency": random.choice([4, 8, 12]),
        "accept_language": profile["accept_language"],
    }

async def save_account(email, password):
    write_header = not os.path.exists(ACCOUNTS_FILE) or os.path.getsize(ACCOUNTS_FILE) == 0
    with open(ACCOUNTS_FILE, "a", encoding="utf-8") as f:
        if write_header:
            f.write("Email    Password\n")
        f.write(f"{email}    {password}\n")
    print(f"账号已保存到: {ACCOUNTS_FILE}")

def resolve_windows_default_browser_executable():
    if sys.platform != "win32":
        return None
    try:
        import winreg
        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice",
        ) as key:
            progid, _ = winreg.QueryValueEx(key, "ProgId")
        if not progid:
            return None
        with winreg.OpenKey(
            winreg.HKEY_CLASSES_ROOT,
            rf"{progid}\shell\open\command",
        ) as key:
            command, _ = winreg.QueryValueEx(key, "")
        if not command:
            return None
        command = command.strip()
        if command.startswith('"'):
            end = command.find('"', 1)
            if end > 1:
                return command[1:end]
        return command.split(" ")[0]
    except Exception:
        return None

def resolve_browser_channel(executable_path):
    if not executable_path:
        return None
    lower = executable_path.lower()
    if "msedge" in lower:
        return "msedge"
    if "chrome" in lower:
        return "chrome"
    return None

async def launch_browser(p, show_window, use_system_browser=True):
    if use_system_browser:
        default_executable = resolve_windows_default_browser_executable()
        channel = resolve_browser_channel(default_executable)
        if channel:
            return await p.chromium.launch(channel=channel, headless=not show_window)
        if default_executable and os.path.exists(default_executable):
            return await p.chromium.launch(
                executable_path=default_executable,
                headless=not show_window,
            )
    return await p.chromium.launch(headless=not show_window)

async def run_registration(show_window=False, use_system_browser=True):
    print("开始单账号注册流程...")
    
    mail_client = AsyncMailClient()
    browser = None
    context = None
    page = None

    try:
        # 1. Setup Mail
        await mail_client.start()
        email = mail_client.get_email()
        password = generate_password()

        # 2. Setup Browser
        async with async_playwright() as p:
            print("启动浏览器...")
            # Use headless=False if you want to watch it, True for background
            browser = await launch_browser(p, show_window, use_system_browser)
            fingerprint = build_random_fingerprint()
            context = await browser.new_context(
                user_agent=fingerprint["user_agent"],
                viewport=fingerprint["viewport"],
                locale=fingerprint["locale"],
                timezone_id=fingerprint["timezone_id"],
                color_scheme=fingerprint["color_scheme"],
                device_scale_factor=fingerprint["device_scale_factor"],
                has_touch=fingerprint["has_touch"],
                extra_http_headers={
                    "Accept-Language": fingerprint["accept_language"]
                },
            )
            await context.add_init_script(
                f"""
                Object.defineProperty(navigator, 'platform', {{
                    get: () => '{fingerprint["platform"]}'
                }});
                Object.defineProperty(navigator, 'hardwareConcurrency', {{
                    get: () => {fingerprint["hardware_concurrency"]}
                }});
                Object.defineProperty(navigator, 'webdriver', {{
                    get: () => undefined
                }});
                """
            )
            print(
                "已应用随机设备指纹："
                f"UA={fingerprint['user_agent']} "
                f"viewport={fingerprint['viewport']['width']}x{fingerprint['viewport']['height']} "
                f"locale={fingerprint['locale']} timezone={fingerprint['timezone_id']}"
            )
            page = await context.new_page()

            # 3. Sign Up Process
            print("打开注册页面...")
            await page.goto("https://www.trae.ai/sign-up")
            
            # Fill Email
            await page.get_by_role("textbox", name="Email").fill(email)
            await page.get_by_text("Send Code").click()
            print("验证码已发送，等待邮件...")

            # Poll for code
            verification_code = None
            for i in range(12): # 60 seconds max
                await mail_client.check_emails()
                if mail_client.last_verification_code:
                    verification_code = mail_client.last_verification_code
                    break
                print(f"正在检查邮箱... ({i+1}/12)")
                await asyncio.sleep(5)

            if not verification_code:
                print("60秒内未收到验证码。")
                return

            # Fill Code & Password
            await page.get_by_role("textbox", name="Verification code").fill(verification_code)
            await page.get_by_role("textbox", name="Password").fill(password)

            # Click Sign Up
            signup_btns = page.get_by_text("Sign Up")
            if await signup_btns.count() > 1:
                await signup_btns.nth(1).click()
            else:
                await signup_btns.click()
            
            print("正在提交注册...")

            # Verify Success (Check URL change or specific element)
            try:
                await page.wait_for_url(lambda url: "/sign-up" not in url, timeout=20000)
                print("注册成功（页面已跳转）")
            except:
                # Check for errors
                if await page.locator(".error-message").count() > 0:
                    err = await page.locator(".error-message").first.inner_text()
                    print(f"注册失败：{err}")
                    return
                print("注册成功检查超时，继续后续流程...")

            # Save Account
            await save_account(email, password)

            # 4. Save Cookies
            cookies = await context.cookies()
            cookie_path = os.path.join(COOKIES_DIR, f"{email}.json")
            with open(cookie_path, "w", encoding="utf-8") as f:
                json.dump(cookies, f)
            print(f"已保存浏览器 Cookie 到: {cookie_path}")

    except Exception as e:
        print(f"发生异常：{e}")
    finally:
        if mail_client:
            await mail_client.close()
        # Browser closes automatically with context manager

async def run_batch(total, concurrency, show_window=False, use_system_browser=True):
    if total <= 0:
        print("批量注册数量必须大于 0。")
        return
    if concurrency <= 0:
        print("并发数量必须大于 0。")
        return
    concurrency = min(concurrency, total)
    print(f"开始批量注册，总数量：{total}，并发数：{concurrency}")

    queue = asyncio.Queue()
    for i in range(1, total + 1):
        queue.put_nowait(i)
    for _ in range(concurrency):
        queue.put_nowait(None)

    async def worker(worker_id):
        while True:
            index = await queue.get()
            if index is None:
                queue.task_done()
                return
            print(f"[线程 {worker_id}] 开始注册第 {index}/{total} 个账号...")
            try:
                await run_registration(show_window, use_system_browser)
            finally:
                print(f"[线程 {worker_id}] 第 {index}/{total} 个账号完成。")
                queue.task_done()

    tasks = [asyncio.create_task(worker(i + 1)) for i in range(concurrency)]
    await queue.join()
    await asyncio.gather(*tasks)

if __name__ == "__main__":
    # if sys.platform == 'win32':
    #     asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    total = 1
    concurrency = 1
    show_window = False
    use_system_browser = True
    if len(sys.argv) > 1:
        try:
            total = int(sys.argv[1])
        except ValueError:
            print("参数错误：请输入批量注册数量（整数）。")
            sys.exit(1)
    if len(sys.argv) > 2:
        try:
            concurrency = int(sys.argv[2])
        except ValueError:
            print("参数错误：请输入并发数量（整数）。")
            sys.exit(1)
    if len(sys.argv) > 3:
        value = str(sys.argv[3]).strip().lower()
        show_window = value in ("1", "true", "yes", "y", "on")
    if len(sys.argv) > 4:
        value = str(sys.argv[4]).strip().lower()
        use_system_browser = value in ("1", "true", "yes", "y", "on")
    asyncio.run(run_batch(total, concurrency, show_window, use_system_browser))
