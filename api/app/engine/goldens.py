"""Golden set, inverted from the readiness guide.

Every substantive claim in the guide already carries its citation, in four
languages and three reading levels. Turning them into questions gives a labelled
set in exactly the register real users write in, for the cost of a morning.

`want` is the provision that must appear in the retrieved set. `avoid` is text
that must not appear in an answer - superseded dates, mostly.
"""

GOLDENS = [
    # --- exact citation ---------------------------------------------------
    dict(q="What does Article 6(3) say?", lang="en", want=["art.6.3"]),
    dict(q="Wat staat er in artikel 50 lid 1?", lang="nl", want=["art.50.1"]),
    dict(q="Que dit l'annexe III point 4 ?", lang="fr", want=["annex.III.4"]),
    dict(q="Was steht in Artikel 5?", lang="de", want=["art.5.1", "art.5.(1)"]),

    # --- prohibited practices --------------------------------------------
    dict(q="Is emotion recognition of employees allowed?", lang="en",
         want=["art.5.1", "art.5.(1)"]),
    dict(q="social scoring of people prohibited practice", lang="en",
         want=["art.5.1", "art.5.(1)"]),
    dict(q="Mag ik emoties van werknemers laten herkennen door AI?", lang="nl",
         want=["art.5.1", "art.5.(1)"]),

    # --- high risk --------------------------------------------------------
    dict(q="Can we use AI to screen CVs for recruitment?", lang="en",
         want=["annex.III.4"]),
    dict(q="Is credit scoring of individuals high risk?", lang="en",
         want=["annex.III.5", "annex.III.5(b)"]),
    dict(q="When does a listed system fall outside high-risk?", lang="en",
         want=["art.6.3"]),
    dict(q="Wanneer valt een systeem uit bijlage III toch niet onder hoog risico?",
         lang="nl", want=["art.6.3"]),

    # --- transparency -----------------------------------------------------
    dict(q="Must we tell users they are talking to an AI?", lang="en",
         want=["art.50.1"]),
    dict(q="marking of synthetic content machine readable", lang="en",
         want=["art.50.2"]),
    dict(q="deepfake disclosure obligation", lang="en", want=["art.50.4"]),
    dict(q="Moeten wij zeggen dat iemand met een AI praat?", lang="nl",
         want=["art.50.1"]),

    # --- roles and duties -------------------------------------------------
    dict(q="When does a deployer become a provider?", lang="en", want=["art.25.1"]),
    dict(q="obligations of deployers of high-risk AI systems", lang="en",
         want=["art.26.1"]),
    dict(q="fundamental rights impact assessment", lang="en", want=["art.27.1"]),
    dict(q="AI literacy obligation for staff", lang="en", want=["art.4.1", "art.4"]),

    # --- penalties and dates ---------------------------------------------
    dict(q="How high are the fines for prohibited practices?", lang="en",
         want=["art.99.3", "art.99.1"]),
    dict(q="Welche Bußgelder gelten für verbotene Praktiken?", lang="de",
         want=["art.99.3", "art.99.(3)", "art.99.1", "art.99.(1)"]),
    dict(q="When do the high-risk obligations apply?", lang="en",
         want=["art.113", "art.113.1"]),
]

# Dates the Digital Omnibus superseded. An answer about a current obligation
# that still states one of these is a hard fail, not a style problem.
SUPERSEDED = ["2 August 2026 as regards high-risk", "2 augustus 2026 voor hoog-risico"]
