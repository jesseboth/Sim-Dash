#!/usr/bin/env python3
"""Fetch and print telemetry JSON from the telemetry server at port 8888."""

import argparse
import json
import os
import time
import urllib.request
import urllib.error

URL = "http://localhost:8888/telemetry"


def fetch(url: str, output: str | None = None) -> None:
    try:
        with urllib.request.urlopen(url, timeout=2) as resp:
            raw = resp.read().decode()
        try:
            parsed = json.loads(raw)
            print(json.dumps(parsed, indent=2))
            if output:
                with open(output, "a") as f:
                    f.write(json.dumps(parsed) + "\n")
        except json.JSONDecodeError:
            print(raw)
            if output:
                with open(output, "a") as f:
                    f.write(raw.strip() + "\n")
    except urllib.error.URLError as e:
        print(f"[error] Could not reach {url}: {e.reason}")
    except Exception as e:
        print(f"[error] {e}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Poll the telemetry server for debugging.")
    parser.add_argument(
        "-f", "--frequency",
        type=float,
        default=1.0,
        help="Polling frequency in Hz (default: 1.0)",
    )
    parser.add_argument(
        "-o", "--output",
        type=str,
        default=None,
        help="Path to output file — cleared on start, one JSON record per line appended each poll",
    )
    args = parser.parse_args()

    if args.output and os.path.exists(args.output):
        open(args.output, "w").close()
        print(f"Cleared existing file: {args.output}")

    interval = 1.0 / args.frequency
    print(f"Polling {URL} at {args.frequency} Hz (every {interval:.3f}s) — Ctrl+C to stop")
    if args.output:
        print(f"Appending to: {args.output}")
    print()

    try:
        while True:
            print(f"--- {time.strftime('%H:%M:%S')} ---")
            fetch(URL, output=args.output)
            print()
            time.sleep(interval)
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
