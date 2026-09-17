"""A deterministic classifier the model is not allowed to overrule.

Deliberately small and rule-shaped: the point the demo makes is architectural,
not legal. A verdict comes from code that can be read and tested, the model may
call it and explain the result, and no band may come from the model itself.
"""

PROHIBITED = {
    "social-scoring", "emotion-workplace", "emotion-education",
    "biometric-categorisation", "untargeted-scraping", "predictive-policing",
    "subliminal", "exploit-vulnerability", "realtime-remote-biometric",
}
HIGH_RISK = {
    "employment", "education", "credit", "insurance", "essential-services",
    "law-enforcement", "migration", "justice", "biometrics", "critical-infrastructure",
}


def assess(args: dict) -> dict:
    kind = (args.get("kind") or "unsure").lower()
    role = (args.get("role") or "deployer").lower()
    detail = (args.get("detail") or "").lower()

    reasons: list[str] = []
    band, classification = "green", "Minimal or no risk"

    if kind == "rules":
        return {"band": "green", "classification": "Not an AI system",
                "reasons": ["Described as deterministic rules, not an AI system "
                            "within the meaning of Article 3(1)."],
                "actions": [], "engine": "deterministic", "overrulable": False}

    hit_prohibited = sorted(p for p in PROHIBITED if p.replace("-", " ") in detail
                            or p in detail)
    hit_high = sorted(h for h in HIGH_RISK if h.replace("-", " ") in detail
                      or h in detail)

    if hit_prohibited:
        band, classification = "red", "Prohibited practice"
        reasons.append("Matches a prohibited practice: " + ", ".join(hit_prohibited))
    elif hit_high:
        band, classification = "amber", "High-risk"
        reasons.append("Falls in a high-risk area: " + ", ".join(hit_high))
    else:
        reasons.append("No prohibited practice or high-risk area matched from the "
                       "description given.")

    if kind == "unsure":
        reasons.append("Whether this is an AI system at all was not established; "
                       "the verdict assumes it is.")

    actions = {
        "red": [{"action": "Stop or redesign the practice", "deadline": "2025-02-02"}],
        "amber": [
            {"action": "Register the system and keep technical documentation",
             "deadline": "2026-08-02"},
            {"action": "Human oversight and logging", "deadline": "2026-08-02"},
        ],
        "green": [],
    }[band]

    if role in ("brand", "modified", "built"):
        reasons.append(f"Role '{role}' can make you the provider, not merely the "
                       "deployer, which carries the heavier obligations.")

    return {"band": band, "classification": classification, "reasons": reasons,
            "actions": actions, "engine": "deterministic", "overrulable": False}
