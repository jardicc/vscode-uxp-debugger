#!/usr/bin/env python3
"""
Diagnostic helper for analyzing Adobe Photoshop / UXP crashes on Windows.

Checks:
1. Recent UXP logs (%APPDATA%\\Adobe\\Adobe Photoshop*\\Logs\\UXPLogs_*.log)
2. ROT47-encoded Adobe LogTransport2CC AppCrash records
   (%APPDATA%\\Adobe\\LogTransport2CC\\Logs\\**\\ulog_*AppCrash*)
3. Adobe RTTransfer SQLite crash databases
   (%APPDATA%\\Adobe\\RTTransfer\\Logs\\*.db)
4. Recent Adobe Crash Reporter XMLs / Windows crash dumps
"""

from __future__ import annotations

import argparse
import datetime as dt
import glob
import os
import re
import sqlite3
import sys
from pathlib import Path


def rot47(text: str) -> str:
    """Decode (or encode) Adobe LogTransport2CC ROT47 obfuscated text."""
    out: list[str] = []
    for ch in text:
        code = ord(ch)
        if 33 <= code <= 126:
            out.append(chr(33 + ((code + 14) % 94)))
        else:
            out.append(ch)
    return "".join(out)


def fmt_ts(epoch_seconds: float) -> str:
    local_dt = dt.datetime.fromtimestamp(epoch_seconds)
    utc_dt = dt.datetime.fromtimestamp(epoch_seconds, tz=dt.timezone.utc)
    return f"{local_dt:%Y-%m-%d %H:%M:%S} local ({utc_dt:%H:%M:%S}Z)"


def inspect_uxp_logs(appdata: Path, cutoff: float, tail_lines: int) -> None:
    print("=" * 72)
    print("1. RECENT PHOTOSHOP UXP LOGS")
    print("=" * 72)
    pattern = str(appdata / "Adobe" / "Adobe Photoshop*" / "Logs" / "UXPLogs_*.log")
    files = [Path(p) for p in glob.glob(pattern)]
    files = [f for f in files if f.stat().st_mtime >= cutoff]
    files.sort(key=lambda f: f.stat().st_mtime, reverse=True)

    if not files:
        print("No UXPLogs_*.log files modified within the selected time window.\n")
        return

    for idx, log_file in enumerate(files[:3]):
        stat = log_file.stat()
        print(f"\n[{idx + 1}] {log_file}")
        print(f"    Last modified: {fmt_ts(stat.st_mtime)} | Size: {stat.st_size:,} bytes")
        try:
            lines = log_file.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError as exc:
            print(f"    Failed to read: {exc}")
            continue

        tail = lines[-tail_lines:] if len(lines) > tail_lines else lines
        print(f"    --- Last {len(tail)} line(s) ---")
        for line in tail:
            if len(line) > 240:
                line = line[:240] + " ... [truncated]"
            print(f"    {line}")

        if tail and "Waiting for the debugger to attach" in tail[-1]:
            print(
                "    [!] NOTE: Log ends abruptly right after 'Waiting for the debugger to attach' "
                "-- strong indicator of an in-process crash during breakOnStart / debugger attach."
            )
    print()


def inspect_logtransport(appdata: Path, cutoff: float) -> None:
    print("=" * 72)
    print("2. ADOBE LOGTRANSPORT2CC CRASH RECORDS (ROT47 DECODED)")
    print("=" * 72)
    base = appdata / "Adobe" / "LogTransport2CC" / "Logs"
    if not base.exists():
        print(f"Directory not found: {base}\n")
        return

    crash_files = [
        p
        for p in base.rglob("ulog_*AppCrash*")
        if p.is_file() and p.stat().st_mtime >= cutoff
    ]
    crash_files.sort(key=lambda f: f.stat().st_mtime, reverse=True)

    if not crash_files:
        print("No ulog_*AppCrash* files found within the selected time window.\n")
        return

    for crash_file in crash_files[:5]:
        stat = crash_file.stat()
        print(f"\nFile: {crash_file}")
        print(f"Modified: {fmt_ts(stat.st_mtime)}")
        raw = crash_file.read_text(encoding="utf-8", errors="replace")
        decoded = rot47(raw)
        xml_start = decoded.find("<?xml")
        if xml_start != -1:
            decoded = decoded[xml_start:]
        for line in decoded.strip().splitlines():
            print(f"  {line}")
    print()


def inspect_rttransfer(appdata: Path, cutoff: float) -> None:
    print("=" * 72)
    print("3. ADOBE RTTRANSFER SQLITE CRASH DATABASES")
    print("=" * 72)
    rt_dir = appdata / "Adobe" / "RTTransfer" / "Logs"
    if not rt_dir.exists():
        print(f"Directory not found: {rt_dir}\n")
        return

    cutoff_ms = int(cutoff * 1000)
    db_files = [
        p
        for p in sorted(rt_dir.glob("*.db"))
        if p.stat().st_mtime >= cutoff and ("PHOTOSHOP" in p.name.upper() or p.name == "RTCommon.db")
    ]
    if not db_files:
        print("No Photoshop/RTCommon SQLite databases modified within the selected time window.\n")
        return

    for db_path in db_files:
        print(f"\nDatabase: {db_path}")
        try:
            con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
            cur = con.cursor()
            rows = cur.execute("SELECT * FROM DataTable ORDER BY rowid DESC LIMIT 10").fetchall()
            con.close()
        except sqlite3.Error as exc:
            print(f"  SQLite error: {exc}")
            continue

        for row in rows:
            ts_ms = next((col for col in row if isinstance(col, int) and col > 1_600_000_000_000), None)
            if ts_ms is not None and ts_ms < cutoff_ms:
                continue
            ts_str = fmt_ts(ts_ms / 1000.0) if ts_ms else "unknown time"
            readable_cols: list[str] = []
            for col in row:
                if isinstance(col, bytes):
                    ascii_parts = re.findall(rb"[ -~]{2,}", col)
                    readable_cols.append(" ".join(part.decode("ascii") for part in ascii_parts))
                else:
                    readable_cols.append(str(col))
            print(f"  [{ts_str}] {' | '.join(readable_cols)}")
    print()


def inspect_crash_dumps(appdata: Path, localappdata: Path, cutoff: float) -> None:
    print("=" * 72)
    print("4. CRASH DUMPS & ADOBE CRASH REPORTER LOGS")
    print("=" * 72)
    search_dirs = [
        appdata / "Adobe" / "CRLogs",
        localappdata / "Adobe" / "CRLogs",
        localappdata / "CrashDumps",
    ]
    found: list[Path] = []
    for directory in search_dirs:
        if directory.exists():
            for item in directory.rglob("*"):
                if item.is_file() and item.stat().st_mtime >= cutoff:
                    found.append(item)

    found.sort(key=lambda f: f.stat().st_mtime, reverse=True)
    if not found:
        print(
            "No recent files in CRLogs or CrashDumps (expected when V8/N-API crashes via "
            "fast-fail / 0x80000003 and exits before the Crash Reporter dialog spawns).\n"
        )
        return

    for item in found[:10]:
        stat = item.stat()
        print(f"  [{fmt_ts(stat.st_mtime)}] {item} ({stat.st_size:,} bytes)")
    print()


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="Inspect recent Photoshop / UXP crash artifacts on Windows.")
    parser.add_argument("--hours", type=float, default=24.0, help="Look back window in hours (default: 24)")
    parser.add_argument("--tail", type=int, default=25, help="Number of trailing lines to show per UXP log (default: 25)")
    args = parser.parse_args()

    appdata = Path(os.environ.get("APPDATA", ""))
    localappdata = Path(os.environ.get("LOCALAPPDATA", ""))
    cutoff = dt.datetime.now().timestamp() - (args.hours * 3600.0)

    inspect_uxp_logs(appdata, cutoff, args.tail)
    inspect_logtransport(appdata, cutoff)
    inspect_rttransfer(appdata, cutoff)
    inspect_crash_dumps(appdata, localappdata, cutoff)


if __name__ == "__main__":
    main()
