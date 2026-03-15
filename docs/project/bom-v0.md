# AGI Probe — Bill of Materials v0

## Compute

| # | Component | Role | Notes |
|---|---|---|---|
| 1 | Raspberry Pi 5 (4GB or 8GB) | Main brain — runs perception loop, change detection, orchestrator | Pi 5 preferred for USB bandwidth and CPU. 4GB sufficient. |
| 2 | MicroSD card (64GB+) | OS + storage for memory DB, frame buffer, logs | A2 rated recommended |
| 3 | USB-C power supply (27W) | Power for Pi 5 | Official Pi 5 PSU for stability |

## Vision

| # | Component | Role | Notes |
|---|---|---|---|
| 4 | USB camera (wide-angle, 1080p) | Eyes — primary perception input | Wide-angle for more context per frame. Logitech C920 or similar. Autofocus preferred. |
| 5 | Pan-tilt servo bracket | Independent gaze — the core of v0 agency | 2-axis bracket with two servo mounts |
| 6 | SG90 micro servos × 2 | Drive the pan-tilt bracket | ~180° range each axis |

## Audio

| # | Component | Role | Notes |
|---|---|---|---|
| 7 | USB microphone | Ears — ambient sound capture | Omnidirectional. Room-level pickup, not close-up speech. |

## Servo Control

| # | Component | Role | Notes |
|---|---|---|---|
| 8 | Arduino Nano or ESP32 | Servo controller — receives serial commands from Pi | Offloads real-time PWM. ESP32 if WiFi needed later. |
| 9 | USB cable (Pi ↔ Arduino/ESP32) | Serial communication | |

## Power & Wiring

| # | Component | Role | Notes |
|---|---|---|---|
| 10 | 5V power supply for servos | Separate power to avoid Pi brownouts | USB breakout or dedicated 5V 2A supply |
| 11 | Jumper wires / breadboard | Prototyping connections | |
| 12 | Common ground wire | Shared ground between Pi, servo PSU, and Arduino | Critical for reliable operation |

## Mounting

| # | Component | Role | Notes |
|---|---|---|---|
| 13 | Tripod or stable base | Physical platform | Small tabletop tripod or 3D-printed base |
| 14 | Camera mount adapter | Attach USB camera to pan-tilt bracket | Small bracket or zip ties |

## Software Services

| Service | Purpose |
|---|---|
| Claude API | The mind — vision + reasoning |
| Deepgram | Cloud STT for audio processing |
| Telegram Bot API | Communication channel (AI → human) |

## Future Upgrade Path: Brushless Gimbal

Hobby servos are a starting point — jerky and imprecise. Upgrade candidates:

| Option | Price | Notes |
|---|---|---|
| Seeed reCamera Gimbal | ~$130 | All-in-one, 0.01° precision, network-controlled |
| SaraKIT + BLDC motors | ~$99 + motors | Pi CM4 carrier, FOC control, Python API |
| SimpleBGC controller + motors | ~$100–150 | Serial API, cinema-grade, maximum flexibility |

## Optional (not required for v0)

| Component | Use case |
|---|---|
| Small speaker | Voice output |
| LED indicator | Visual feedback ("thinking", "detected something") |
| IR camera / night vision module | Night mode visibility |
| UPS / battery hat for Pi | Graceful shutdown, portability |

## Estimated Cost

| Category | Estimate |
|---|---|
| Raspberry Pi 5 + PSU + SD | ~$80–100 |
| Camera | ~$30–70 |
| Pan-tilt bracket + servos | ~$10–15 |
| USB mic | ~$10–20 |
| Arduino Nano / ESP32 | ~$5–15 |
| Power, wiring, mounting | ~$15–25 |
| **Total** | **~$150–250** |
