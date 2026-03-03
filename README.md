# PRISM: Price Intelligence and Smart Monitoring 
### An integrated solution for SGD 8: Decent Work and Economic Growth
### By Team SRPeak

PRISM is an **AI-powered price intelligence platform** that is designed to defend against 
price manipulation, market opacity, and ineffiecient purchasing decisions in the Philippines.
Empowering Filipino consumers, MSMEs, and government agencies with fair real-time market value analysis
and forensic pricing insights.


### Solution Overview
PRISM features:
- AI-powered forensic analysis
- Real transaction-based intelligence
- Daily recalibrated fair market values
- Anomaly Detection

Users can then input details of specific products and see:
- The 24-hour average price
- Fair value range
- Anomaly flags
- Pricing Trend analysis

### Team Members: SRPeak
- Jecer Sarte Egagamao
- Gian Marco De La Cruz
- Jan Krishnel Abuyo
- Dave Augustin Gadon
- Madeleine Sophie Rapsing

## Vision of PRISM

To eliminate price opacity and empower every Filipino consumer and businesses with accurate, real-time pricing intelligence.


## Docker Setup

**Prerequisite:** [Docker Desktop](https://www.docker.com)

1. Open VSCode Terminal (or Command Prompt) and Docker Desktop application
   - If using cmd, make sure to change directory to repo folder first: `cd <PRISM FILEPATH HERE>`

2. Run `docker compose down -v`

3. Run `docker compose up --build`
   - docker watch is currently not configured for the new updates. When saving changes, always compose down and compose up again. ~~To enable live updates: run docker compose up --watch instead. Every time you save changes, refresh to see the updated page.~~

4. Open http://localhost:3000

5. To stop build, press Ctrl+C in terminal
   - Docker image takes up a lot of space. To delete, open Docker Desktop and search for PRISM Docker image (probably named smth like "prism-image")

**To view PRISM on phone/other device**

1. Connect your phone to the same wifi as the computer running docker

2. Find your computer's local IP
   - Open cmd and run `ipconfig`
   - Your IP address under smth like "Wireless LAN adapter Wi-Fi -> IPv4 Address" or smth similar

3. Open `<IPADDRESS>:3000` on your phone browser

**To enable AI functionality**

1. Create a file in the outermost folder: `.env`
   - This file should **not** be committed to the repo and is private

2. Request AI API key

3. Input into `.env` the following:
   - `DEEPSEEK_API_KEY=<API key here>`
