// Pinned P0-S11 public test vector; never event material.
import { openScore, scoreAad } from "./score-cipher";
import type { Hex } from "../types/primitives";
export function assertScoreCipherWorks() {
  const context = {
    event: "mumbai2026",
    submission: "0x5555555555555555555555555555555555555555555555555555555555555555",
    judge: "ana.judges.arkiv.partners",
    rubric: "0x7777777777777777777777777777777777777777777777777777777777777777",
    assignment: "0x9999999999999999999999999999999999999999999999999999999999999999",
  };
  const envelope =
    "0x011c78fc71ef01855f670c555c82226397f0e73b0aaf443a491d4110dc22f28236101010101010101010101010f9c70a9696b9d4043196b387a84465a908d744fc29e95e203935672e583477285ccdeb30792936403d2000e571276c5d631e647ebb0d49196db6929a529fdc4dfd1db89c3337d2b57c76afd584b951985e8019cb02645e65f543fe6e5e13870c9d7344812a89" as Hex;
  const expected =
    "0x7b226372697465726961223a5b7b226964223a22696d70616374222c2276616c7565223a3735307d2c7b226964223a2274656368222c2276616c7565223a3832307d5d2c22736368656d6156657273696f6e223a317d";
  const bytes = openScore(
    `0x${"a1".repeat(32)}`,
    envelope,
    scoreAad({
      ...context,
      submission: context.submission as Hex,
      rubric: context.rubric as Hex,
      assignment: context.assignment as Hex,
    }),
  );
  const actual = `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
  if (actual !== expected) throw new Error("Pinned score cipher self-test failed");
}
