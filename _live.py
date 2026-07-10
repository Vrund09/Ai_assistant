import httpx, asyncio

async def check():
    async with httpx.AsyncClient(timeout=30) as c:
        print("1. Health...")
        r = await c.get("https://gcc-livid.vercel.app/api/health")
        print(f"   {r.json()}")

        print("\n2. Chat (weather)...")
        r = await c.post("https://gcc-livid.vercel.app/api/chat",
            json={"message": "what is the weather in Hyderabad"})
        d = r.json()
        print(f"   blocked={d['blocked']}")
        print(f"   reply={d['reply']}")
        print(f"   latency={d.get('latency_ms',0):.0f}ms")

        print("\n3. Guardrail...")
        r = await c.post("https://gcc-livid.vercel.app/api/chat",
            json={"message": "fuck you"})
        d = r.json()
        print(f"   blocked={d['blocked']} ({d.get('block_reason','')})")

asyncio.run(check())
