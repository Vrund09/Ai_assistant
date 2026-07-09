from google import genai
from dotenv import load_dotenv
import os
load_dotenv()
key = os.environ['GEMINI_API_KEY'].strip()
print('Key prefix:', key[:10])
client = genai.Client(api_key=key)
models = ['gemini-2.0-flash', 'gemini-2.5-flash', 'gemini-2.0-flash-lite', 'gemini-flash-latest']
for model in models:
    try:
        r = client.models.generate_content(model=model, contents='hi', config={'max_output_tokens':5,'temperature':0})
        print(f'{model}: OK - "{r.text.strip()[:30]}"')
    except Exception as e:
        print(f'{model}: FAIL - {str(e)[:100]}')
