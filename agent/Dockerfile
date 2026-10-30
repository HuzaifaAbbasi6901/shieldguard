# ShieldGuard local agent (defensive monitoring) — runs on the host so it can
# watch folders. File watching inside containers is limited to mounted volumes.
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY api ./api
COPY detectors ./detectors
COPY services ./services
COPY run.py .

ENV SHIELDGUARD_DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 8787

# The agent must be able to see the folders you want to protect:
# mount them and add them in the dashboard (e.g. -v /home/me/Documents:/watched/Documents)
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8787"]
