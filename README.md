# PRISM
***Ai pwoered price checker and regulator***

**by Team PRISM - Abuyo, de la Cruz, Egagamao, Gadon, Rapsing**

University of the Philippines - Cebu - SRP Campus


Track: SDG 8 - Decent Work and Sustainable Growth


## Docker Setup

**Prerequisite:** [Docker Desktop](https://www.docker.com)

1. Open VSCode Terminal (or Command Prompt)
   - If using cmd, make sure to change directory to repo folder first: `cd <PRISM FILEPATH HERE>`

2. Run `docker compose up --build`
   - To enable live updates: run `docker compose up --watch` instead. Every time you save changes, refresh to see the updated page.
   - If these commands fail: run `docker compose down`. Then try above commands again.

3. Open http://localhost:3000

4. To stop build, press Ctrl+C in terminal
   - Docker image takes up a lot of space. To delete, open Docker Desktop and search for PRISM Docker image (probably named smth like "prism-image")

**To view PRISM on phone/other device**

1. Connect your phone to the same wifi as the computer running docker

2. Find your computer's local IP
   - Open cmd and run `ipconfig`
   - Your IP address under smth like "Wireless LAN adapter Wi-Fi -> IPv4 Address" or smth similar

3. Open `<IPADDRESS>:3000` on your phone browser

