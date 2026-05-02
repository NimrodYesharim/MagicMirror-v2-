"""
Run this once on the Pi to authorize Google Calendar access.
Requires credentials.json downloaded from Google Cloud Console.

    python setup_calendar.py
"""
from google_auth_oauthlib.flow import InstalledAppFlow
from pathlib import Path

SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"]
CREDS = Path("widgets/calendar/credentials.json")
TOKEN = Path("widgets/calendar/token.json")

if not CREDS.exists():
    print("widgets/calendar/credentials.json not found.")
    print("Download it from: https://console.cloud.google.com/ → APIs & Services → Credentials")
    print("Then place it at: widgets/calendar/credentials.json")
    raise SystemExit(1)

flow = InstalledAppFlow.from_client_secrets_file(str(CREDS), SCOPES)
creds = flow.run_local_server(port=0)
TOKEN.write_text(creds.to_json(), encoding='utf-8')
print(f"Token saved to {TOKEN}. You can now start the mirror.")
