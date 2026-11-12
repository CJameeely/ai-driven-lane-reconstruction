"""Procedural sound design for DIGITAL_SPACE_01_08_CINEMATIC (183 s). Everything is synthesised here
from noise and sine partials; no samples or music are used. Output: 48 kHz 16-bit stereo WAV.

usage: python3 web/cinematic_01_08_audio.py out.wav
"""
import sys, wave
import numpy as np

SR, DUR = 48000, 183.0
N = int(SR * DUR)
rng = np.random.default_rng(20261112)
L = np.zeros(N); R = np.zeros(N)
t = np.arange(N) / SR


def env(a, b, fade_in, fade_out):
    """0..1 envelope between seconds a and b."""
    e = np.clip((t - a) / max(fade_in, 1e-3), 0, 1) * np.clip((b - t) / max(fade_out, 1e-3), 0, 1)
    return e


def band(x, lo, hi):
    """Band-limit a signal with an FFT mask (smooth edges)."""
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR)
    m = np.clip((f - lo * .7) / (lo * .3 + 1e-9), 0, 1) * np.clip((hi * 1.3 - f) / (hi * .3), 0, 1)
    return np.fft.irfft(X * m, len(x))


def norm(x):
    return x / (np.max(np.abs(x)) + 1e-9)


def add(sig, start, gain=1.0, pan=0.0):
    i = int(start * SR)
    if i >= N: return
    s = sig[: N - i] * gain
    L[i:i + len(s)] += s * np.sqrt((1 - pan) / 2); R[i:i + len(s)] += s * np.sqrt((1 + pan) / 2)


def burst(dur, lo, hi, decay):
    n = int(dur * SR); x = band(rng.standard_normal(n), lo, hi)
    return norm(x) * np.exp(-np.arange(n) / SR / decay)


def tone(dur, freqs, decay, attack=.004):
    n = int(dur * SR); tt = np.arange(n) / SR
    x = sum(np.sin(2 * np.pi * f * tt) * a for f, a in freqs)
    return x * np.exp(-tt / decay) * np.clip(tt / attack, 0, 1)


white = rng.standard_normal(N)
brown = np.cumsum(white); brown -= np.convolve(brown, np.ones(4801) / 4801, 'same'); brown = norm(brown)

# ---- continuous bed: low pad that ties the stages together -----------------------------------------
pad = (np.sin(2 * np.pi * 55 * t) * .5 + np.sin(2 * np.pi * 82.4 * t) * .25 + np.sin(2 * np.pi * 110.3 * t) * .12) * (0.6 + .4 * np.sin(2 * np.pi * t / 23))
bed = pad * (env(0, 183, 4, 5) * .05)
L += bed; R += bed

# ---- 00 opening: air + soft rise ------------------------------------------------------------------
air = norm(band(white, 200, 2500)) * env(0, 8, 3, 3) * .025
L += air; R += np.roll(air, 900)

# ---- 01 FIRE 6–29: low thermal rumble + granular crackle --------------------------------------------
fireE = np.clip((t - 6) / 10, 0, 1) * np.clip((29 - t) / 6, 0, 1)
rum = norm(band(brown, 25, 260)) * fireE * .32
L += rum; R += np.roll(rum, 400)
for _ in range(1300):
    s = rng.uniform(6.5, 28); dens = np.clip((s - 6) / 10, 0, 1) * np.clip((29 - s) / 6, 0, 1)
    if rng.random() > dens: continue
    add(burst(rng.uniform(.006, .03), 1800, 7000, rng.uniform(.004, .012)), s, rng.uniform(.02, .07) * dens, rng.uniform(-.7, .7))
for _ in range(90):  # occasional deeper pops
    s = rng.uniform(9, 24); add(burst(.08, 120, 900, .03), s, rng.uniform(.04, .08), rng.uniform(-.5, .5))

# ---- 02 DAMAGE 22–43: cold scan pulses and a sweep that follows the scan plane ----------------------
for k, s in enumerate(np.arange(23.0, 42.5, 1.2)):
    add(tone(.9, [(880, .6), (1320, .25), (1760, .1)], .22, .01), s, .07, -.35 + .7 * ((s - 23) / 20))
sweep_n = int(16 * SR); sw = band(rng.standard_normal(sweep_n), 300, 4000)
fc = np.linspace(500, 2600, sweep_n); ph = np.cumsum(2 * np.pi * fc / SR)
sweep = norm(sw) * (0.3 + 0.7 * (np.sin(ph * .002) ** 2)) * np.sin(np.linspace(0, np.pi, sweep_n)) * .045
add(sweep, 25, 1, 0)
hum = np.sin(2 * np.pi * 220 * t) * .5 + np.sin(2 * np.pi * 330 * t) * .3
L += hum * env(24, 43, 2, 2) * .018; R += hum * env(24, 43, 2, 2) * .018

# ---- 03 INFERENCE 43–63: node connections, small computation ticks, soft pings ----------------------
for _ in range(240):
    s = rng.uniform(43.5, 62.5); add(burst(.012, 3000, 9000, .003), s, rng.uniform(.03, .06), rng.uniform(-.8, .8))
notes = [659.3, 784, 880, 987.8, 1174.7, 1318.5]
for s in np.arange(44, 62, .9):
    f = notes[rng.integers(len(notes))]; add(tone(1.6, [(f, .7), (f * 2, .15)], .5, .008), s + rng.uniform(-.2, .2), .03, rng.uniform(-.6, .6))
chord = sum(np.sin(2 * np.pi * f * t) for f in (220, 261.6, 329.6)) / 3
L += chord * env(43, 63, 3, 2) * .02; R += chord * env(43, 63, 3, 2) * .02

# ---- 04 RETURN 63–76: low spatial unfolding swell --------------------------------------------------
sw2 = (np.sin(2 * np.pi * (40 + 20 * np.clip((t - 63) / 13, 0, 1)) * t) * .6 + norm(band(brown, 30, 400)) * .5)
L += sw2 * env(63, 77, 6, 3) * .04; R += sw2 * env(63, 77, 6, 3) * .04

# ---- 05 ALMOND 76–98: soft organic growth (breathing filtered noise, warm pad, faint creaks) ---------
breath = norm(band(white, 300, 1800)) * (0.5 + .5 * np.sin(2 * np.pi * t / 3.7) ** 2)
L += breath * env(76, 98, 2, 2) * .03; R += np.roll(breath, 2000) * env(76, 98, 2, 2) * .03
warm = sum(np.sin(2 * np.pi * f * t) for f in (146.8, 220, 293.7, 370)) / 4
L += warm * env(76, 98, 3, 2) * .03; R += warm * env(76, 98, 3, 2) * .03
for s in np.arange(78, 96, 1.4):
    add(tone(1.2, [(rng.uniform(180, 320), .8), (rng.uniform(500, 700), .2)], .35, .05), s + rng.uniform(0, .5), .035, rng.uniform(-.6, .6))

# ---- 06 BAN 98–121: light structural assembly (cardboard tube knocks, paper rustle) -----------------
s = 99.2
while s < 117:
    add(tone(.25, [(rng.uniform(260, 420), .7), (rng.uniform(700, 1100), .2)], .045, .002) + burst(.25, 800, 4000, .02) * .3, s, .09, rng.uniform(-.7, .7))
    s += rng.uniform(.35, .8)
for _ in range(60):
    st = rng.uniform(100, 118); add(burst(.35, 2500, 9000, .12), st, .02, rng.uniform(-.8, .8))

# ---- 07 SHIKUMEN 121–146: restrained bricklaying, joinery, then tiles --------------------------------
s = 122.5
while s < 141.5:
    phase = 'brick' if s < 131 else 'trim' if s < 137 else 'tile'
    if phase == 'brick':
        add(burst(.12, 1600, 3600, .018) * .8 + tone(.12, [(150, 1)], .03) * .5, s, .085, rng.uniform(-.6, .6)); s += rng.uniform(.28, .5)
    elif phase == 'trim':
        add(tone(.3, [(rng.uniform(200, 300), .7), (rng.uniform(600, 800), .3)], .06, .002), s, .08, rng.uniform(-.6, .6)); s += rng.uniform(.45, .8)
    else:
        add(burst(.2, 3500, 8000, .01) * .6 + tone(.2, [(1850 + rng.uniform(-150, 150), 1)], .05), s, .055, rng.uniform(-.7, .7)); s += rng.uniform(.18, .32)
base7 = norm(band(brown, 40, 300))
L += base7 * env(121, 146, 2, 3) * .05; R += base7 * env(121, 146, 2, 3) * .05

# ---- 08 CITY 144–183: quiet urban ambience, distant traffic swells, low atmosphere --------------------
amb = norm(band(white, 80, 1400))
L += amb * env(144, 183, 4, 6) * .03; R += np.roll(amb, 3000) * env(144, 183, 4, 6) * .03
for st in (150, 157.5, 166, 172):
    n = int(5 * SR); car = norm(band(rng.standard_normal(n), 60, 900)) * np.sin(np.linspace(0, np.pi, n)) ** 2
    add(car, st, .06, rng.uniform(-.8, .8))
atm = np.sin(2 * np.pi * 41.2 * t) * .6 + np.sin(2 * np.pi * 61.7 * t) * .3
L += atm * env(146, 183, 6, 7) * .022; R += atm * env(146, 183, 6, 7) * .022

# ---- master: fades, gentle limiting, -3 dBFS peak -------------------------------------------------------
master = np.clip(t / 1.6, 0, 1) * np.clip((DUR - t) / 2.5, 0, 1)
L *= master; R *= master
st = np.stack([L, R], 1)
st = np.tanh(st * 1.6) / 1.6
st *= 10 ** (-3 / 20) / np.max(np.abs(st))
pcm = (st * 32767).astype('<i2')
with wave.open(sys.argv[1], 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
rms = np.sqrt(np.mean(st ** 2)); print('wrote', sys.argv[1], f'{DUR}s', f'rms {20 * np.log10(rms):.1f} dBFS')
