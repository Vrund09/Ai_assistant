from dotenv import load_dotenv
import os, httpx
load_dotenv()
key = os.environ.get('SIMLI_API_KEY','').strip()
face = os.environ.get('SIMLI_FACE_ID','').strip()
print('Key:', key)
print('Face:', face)

print('\n1. Testing ICE...')
try:
    r = httpx.get('https://api.simli.com/compose/ice', headers={'x-simli-api-key': key}, timeout=10)
    print('Status:', r.status_code)
    print('Body:', r.text[:300])
except Exception as e:
    print('Error:', e)

print('\n2. Testing token...')
try:
    r = httpx.post('https://api.simli.com/compose/token', 
        json={'faceId': face, 'handleSilence': True, 'maxSessionLength': 3600, 'maxIdleTime': 300},
        headers={'x-simli-api-key': key, 'Content-Type': 'application/json'},
        timeout=10)
    print('Status:', r.status_code)
    print('Body:', r.text[:300])
except Exception as e:
    print('Error:', e)
