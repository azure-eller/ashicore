# I3 liveness sweep — fault-validation record

Produced by `test/e2e/validate-i3-liveness.sh`. Re-run it and replace this file whenever the sweep SQL in `test/e2e/invariants.spec.ts` changes — the script embeds a copy of the query, so drift between the two invalidates this record.

```
== I3 liveness fault validation — 2026-07-21T00:00:38Z ==
== git 12cce38f+dirty ==
setup: PO 1263beb2-4453-4677-a388-2fb618c60155 line 36cc4acc-9faa-412f-a59f-dd907a007da2 (10 ordered, 0 received) — sweep must be clean
  clean
fault 1: wrong quantity (expected row inflated by 1)
  KILLED: 36cc4acc-9faa-412f-a59f-dd907a007da2 | stored: qty=11.0000 rows=1 item=9fff4e7c-b095-4365-8ad5-a43a77c90b56 | live: qty=10.0000 rows=1 item=9fff4e7c-b095-4365-8ad5-a43a77c90b56
  clean
fault 2: missing row (open line, expected row deleted)
  KILLED: 36cc4acc-9faa-412f-a59f-dd907a007da2 | stored: no rows | live: qty=10.0000 rows=1 item=9fff4e7c-b095-4365-8ad5-a43a77c90b56
  clean
fault 3: orphan row (expected row pointing at a line that never existed)
  KILLED: b1a3af66-8aaa-4e80-b9de-d477deb2a781 | stored: qty=5.0000 rows=1 item=9fff4e7c-b095-4365-8ad5-a43a77c90b56 | live: no live line
  clean
fault 4: deleted order still contributing (soft-deleted, row left behind)
  KILLED: 36cc4acc-9faa-412f-a59f-dd907a007da2 | stored: qty=10.0000 rows=1 item=9fff4e7c-b095-4365-8ad5-a43a77c90b56 | live: no live line
  clean
fault 5: closed line still contributing (received = ordered, row left behind)
  KILLED: 36cc4acc-9faa-412f-a59f-dd907a007da2 | stored: qty=10.0000 rows=1 item=9fff4e7c-b095-4365-8ad5-a43a77c90b56 | live: no rows
  clean
fault 6: wrong item identity (right quantity, row on the wrong item)
  KILLED: 36cc4acc-9faa-412f-a59f-dd907a007da2 | stored: qty=10.0000 rows=1 item=fe578faa-e859-4cdb-9d7d-8b7f5a100a57 | live: qty=10.0000 rows=1 item=9fff4e7c-b095-4365-8ad5-a43a77c90b56
  clean
fault 7: duplicate row (two rows that sum to the correct remainder)
  KILLED: 36cc4acc-9faa-412f-a59f-dd907a007da2 | stored: qty=10.0000 rows=2 item=9fff4e7c-b095-4365-8ad5-a43a77c90b56 | live: qty=10.0000 rows=1 item=9fff4e7c-b095-4365-8ad5-a43a77c90b56
  clean
== 7/7 faults killed, sweep clean between every fault ==
```
