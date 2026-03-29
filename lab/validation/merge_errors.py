#!/usr/bin/env python3
"""
Merge all lab/validation/errors-*.yaml into lab/validation/errors-all.yaml
with aggressive deduplication and source_refs.
"""
from __future__ import annotations

import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

import yaml

LAB = Path(__file__).resolve().parent
SOURCES = sorted(p for p in LAB.glob("errors-*.yaml") if p.name != "errors-all.yaml")
TARGET = LAB / "errors-all.yaml"


def load_yaml(p: Path) -> dict[str, Any]:
    with open(p, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def norm_ts(s: str | None) -> str | None:
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt.strftime("%Y-%m-%dT%H:%M:%S%z")
    except Exception:
        return s


def problem_signature(rec: dict, key: str = "problem") -> str:
    """Normalized signature for dedup: file + category + first meaningful line."""
    text = rec.get(key) or ""
    if isinstance(text, str):
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    else:
        lines = []
    first = (lines[0][:120] if lines else "") or ""
    first = re.sub(r"\s+", " ", first).strip()
    return f"{rec.get('file','')}|{rec.get('category','')}|{first}"


def issue_signature(rec: dict) -> str:
    return problem_signature(rec, "issue")


def backend_cause_signature(rec: dict, key: str = "problem") -> str:
    """Extract backend-related signature for cross-file dedup."""
    f = rec.get("file", "")
    if "py_backend" not in f and "our/" not in f:
        return ""
    text = rec.get(key) or ""
    if isinstance(text, str):
        text = text[:300]
    else:
        text = ""
    # Key phrases for backend issues
    low = text.lower()
    if "invalidrequesterror" in low or "400" in low and "500" in low:
        if "movements" in low or "get_movements" in low:
            return "routes:GET/api/movements:InvalidRequestError->500"
    if "limit" in low and "offset" in low and ("0" in low or "zero" in low):
        if "getitems" in low or "get_items" in low or "box" in low:
            return "storage:getItems:limit0_offset0_when_box_not_found"
    if "updateshipmentstatus" in low or "shipment" in low and "status" in low:
        if "rollback" in low or "delivered" in low and "pending" in low:
            return "storage:updateShipmentStatus:no_rollback_validation"
    if "our/algorithms" in low or "alg:" in low or "missing-binding" in low:
        return "our/algorithms.yaml:missing"
    if "parse_csv" in low or "crlf" in low or "\\r\\n" in low:
        return "routes:parse_csv:CRLF"
    if "bom" in low or "\\ufeff" in low:
        return "routes:csv:BOM"
    if "archived" in low and "bool" in low:
        return "storage:updateCustomer:archived_bool_coercion"
    return ""


def cluster_key_error(rec: dict, source_file: str) -> tuple[str, str]:
    """(primary_key, backend_cause) for error dedup."""
    sig = problem_signature(rec)
    bc = backend_cause_signature(rec)
    if bc:
        return (bc, sig)
    return (sig, sig)


def cluster_key_improvement(rec: dict, source_file: str) -> str:
    return issue_signature(rec)


def _ts_str(x: Any) -> str:
    if x is None:
        return ""
    if hasattr(x, "isoformat"):
        return x.isoformat()
    return str(x)


def merge_findings(all_findings: list[dict]) -> list[dict]:
    seen = set()
    out = []
    for f in all_findings:
        ts = f.get("timestamp")
        key = (
            f.get("agent", ""),
            _ts_str(ts),
            (f.get("note") or "")[:80],
        )
        if key in seen:
            continue
        seen.add(key)
        out.append(f)
    out.sort(key=lambda x: (_ts_str(x.get("timestamp")), x.get("agent", "")))
    return out


def merge_errors(group: list[tuple[dict, str, str]]) -> dict:
    """Merge a group of error records. First is canonical."""
    canonical, src_file, src_id = group[0]
    merged = {
        "file": canonical.get("file"),
        "category": canonical.get("category"),
        "severity": "critical" if any(r[0].get("severity") == "critical" for r in group) else "warning",
        "problem": canonical.get("problem"),
        "code_example": canonical.get("code_example"),
        "found_count": sum(r[0].get("found_count") or 0 for r in group),
        "rejected_count": max(r[0].get("rejected_count") or 0 for r in group),
        "fix": next((r[0].get("fix") for r in group if r[0].get("fix")), None),
        "source_refs": [
            {"source_file": sf, "source_id": sid}
            for _, sf, sid in group
        ],
    }
    all_findings = []
    for r, _, _ in group:
        all_findings.extend(r.get("findings") or [])
    merged["findings"] = merge_findings(all_findings)
    return merged


def merge_improvements(group: list[tuple[dict, str, str]]) -> dict:
    canonical, src_file, src_id = group[0]
    merged = {
        "file": canonical.get("file"),
        "category": canonical.get("category"),
        "issue": canonical.get("issue"),
        "code_example": canonical.get("code_example"),
        "found_count": sum(r[0].get("found_count") or 0 for r in group),
        "fix": next((r[0].get("fix") for r in group if r[0].get("fix")), None),
        "source_refs": [
            {"source_file": sf, "source_id": sid}
            for _, sf, sid in group
        ],
    }
    all_findings = []
    for r, _, _ in group:
        all_findings.extend(r.get("findings") or [])
    merged["findings"] = merge_findings(all_findings)
    return merged


def main() -> None:
    source_files = [p.name for p in SOURCES]
    all_errors: list[tuple[dict, str, str]] = []
    all_improvements: list[tuple[dict, str, str]] = []
    meta_dates: list[str] = []
    targets: list[str] = []

    for p in SOURCES:
        data = load_yaml(p)
        meta = data.get("meta") or {}
        if meta.get("created"):
            meta_dates.append(meta["created"])
        if meta.get("last_updated"):
            meta_dates.append(meta["last_updated"])
        if meta.get("target"):
            targets.append(
                (meta["target"][:80] + "..." if len(str(meta["target"])) > 80 else meta["target"])
            )

        for e in data.get("errors") or []:
            eid = e.get("id", "")
            all_errors.append((e, f"lab/validation/{p.name}", eid))
        for i in data.get("improvements") or []:
            iid = i.get("id", "")
            all_improvements.append((i, f"lab/validation/{p.name}", iid))

    errors_before = len(all_errors)
    improvements_before = len(all_improvements)
    records_before = errors_before + improvements_before

    # Cluster errors: prefer backend_cause for cross-file, else problem_signature
    error_clusters: dict[str, list[tuple[dict, str, str]]] = {}
    for rec, src_file, src_id in all_errors:
        pk, _ = cluster_key_error(rec, src_file)
        if pk not in error_clusters:
            error_clusters[pk] = []
        error_clusters[pk].append((rec, src_file, src_id))

    # Additional semantic merges for known duplicates
    def merge_similar_error_clusters():
        # Same backend cause: GET /api/movements InvalidRequestError
        mov_keys = [k for k in error_clusters if "routes:GET/api/movements" in str(k)]
        if len(mov_keys) > 1:
            first = mov_keys[0]
            for k in mov_keys[1:]:
                error_clusters[first].extend(error_clusters.pop(k))

        # getItems limit:0
        items_keys = [k for k in error_clusters if "storage:getItems" in str(k)]
        if len(items_keys) > 1:
            first = items_keys[0]
            for k in items_keys[1:]:
                error_clusters[first].extend(error_clusters.pop(k))

        # our/algorithms.yaml
        alg_keys = [k for k in error_clusters if "our/algorithms" in str(k)]
        if len(alg_keys) > 1:
            first = alg_keys[0]
            for k in alg_keys[1:]:
                error_clusters[first].extend(error_clusters.pop(k))

        # shipment status rollback
        ship_keys = [k for k in error_clusters if "updateShipmentStatus" in str(k)]
        if len(ship_keys) > 1:
            first = ship_keys[0]
            for k in ship_keys[1:]:
                error_clusters[first].extend(error_clusters.pop(k))

    merge_similar_error_clusters()

    # Cluster improvements by issue_signature
    imp_clusters: dict[str, list[tuple[dict, str, str]]] = {}
    for rec, src_file, src_id in all_improvements:
        pk = cluster_key_improvement(rec, src_file)
        if pk not in imp_clusters:
            imp_clusters[pk] = []
        imp_clusters[pk].append((rec, src_file, src_id))

    # Merge DRY invalidateQueries improvements
    dry_inv = [k for k in imp_clusters if "invalidate" in (imp_clusters[k][0][0].get("issue") or "").lower() and "dry" in (imp_clusters[k][0][0].get("category") or "").lower()]
    if len(dry_inv) > 1:
        # Keep distinct by file - different files = different improvements
        pass  # Don't over-merge improvements

    merged_errors = []
    for i, (_, group) in enumerate(sorted(error_clusters.items(), key=lambda x: (x[1][0][0].get("severity", "z"), x[1][0][0].get("file", ""))), 1):
        m = merge_errors(group)
        m["id"] = f"e-all-{i:03d}"
        merged_errors.append(m)

    merged_improvements = []
    for i, (_, group) in enumerate(sorted(imp_clusters.items(), key=lambda x: x[1][0][0].get("file", "")), 1):
        m = merge_improvements(group)
        m["id"] = f"i-all-{i:03d}"
        merged_improvements.append(m)

    # Meta
    def _norm_date(d: Any) -> str:
        if d is None:
            return ""
        if hasattr(d, "isoformat"):
            return d.isoformat()[:10]
        return str(d)[:10]

    dates_str = [_norm_date(d) for d in meta_dates if d]
    created = min(dates_str) if dates_str else "2026-02-10"
    last_updated = max(
        (_ts_str(d) for d in meta_dates if d),
        key=lambda x: (x or "")[:19],
        default="2026-02-12T00:46:42+0400",
    )
    if last_updated and len(last_updated) >= 19 and last_updated[10] == "T":
        pass
    else:
        last_updated = "2026-02-12T00:46:42+0400"

    target_desc = "Объединённый отчёт валидации: " + "; ".join(targets[:5])
    if len(targets) > 5:
        target_desc += f" ... (+{len(targets)-5} модулей)"

    meta_all = {
        "target": target_desc,
        "created": created,
        "last_updated": last_updated,
        "source_files": [f"lab/validation/{f}" for f in source_files],
        "source_counts": {
            "errors_total_before": errors_before,
            "improvements_total_before": improvements_before,
            "records_total_before": records_before,
        },
        "dedup_counts": {
            "errors_after": len(merged_errors),
            "improvements_after": len(merged_improvements),
            "records_after": len(merged_errors) + len(merged_improvements),
        },
    }

    out = {
        "meta": meta_all,
        "errors": merged_errors,
        "improvements": merged_improvements,
    }

    with open(TARGET, "w", encoding="utf-8") as f:
        yaml.dump(out, f, allow_unicode=True, default_flow_style=False, sort_keys=False, width=120)

    # Validation
    loaded = load_yaml(TARGET)
    assert "errors" in loaded and "improvements" in loaded
    ids_e = {e["id"] for e in loaded["errors"]}
    ids_i = {i["id"] for i in loaded["improvements"]}
    assert len(ids_e) == len(loaded["errors"])
    assert len(ids_i) == len(loaded["improvements"])
    assert ids_e.isdisjoint(ids_i)

    covered = set()
    for e in loaded["errors"]:
        for ref in e.get("source_refs") or []:
            covered.add((ref["source_file"], ref["source_id"]))
    for i in loaded["improvements"]:
        for ref in i.get("source_refs") or []:
            covered.add((ref["source_file"], ref["source_id"]))

    exp_norm = set()
    for rec, sf, sid in all_errors:
        sfn = sf if sf.startswith("lab/") else f"lab/validation/{Path(sf).name}"
        exp_norm.add((sfn, sid))
    for rec, sf, sid in all_improvements:
        sfn = sf if sf.startswith("lab/") else f"lab/validation/{Path(sf).name}"
        exp_norm.add((sfn, sid))

    coverage = len(exp_norm & covered) / len(exp_norm) * 100 if exp_norm else 100

    print("=== MERGE COMPLETE ===")
    print(f"Target: {TARGET}")
    print(f"Source files: {len(source_files)}")
    print(f"Before: errors={errors_before}, improvements={improvements_before}, total={records_before}")
    print(f"After: errors={len(merged_errors)}, improvements={len(merged_improvements)}, total={len(merged_errors)+len(merged_improvements)}")
    print(f"Error clusters: {len(error_clusters)}")
    print(f"Improvement clusters: {len(imp_clusters)}")
    print(f"Coverage (source_refs): {coverage:.1f}%")
    assert coverage >= 99.9, f"Coverage {coverage}% < 100%"


if __name__ == "__main__":
    main()
