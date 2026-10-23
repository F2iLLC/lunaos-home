# Learn about me: typed profile draft

`lib/profile-draft.js` defines a bounded, strict contract for a proposed profile assembled from observations that are already authorized by a caller. The helper is pure: it does not query assistant memory, email, calendars, or another source; it does not call a model or save records.

The input carries explicit source coverage. Unavailable and unauthorized sources remain visible in the output, and an observation is rejected unless its source is declared available. Each proposed field retains its source IDs and observed values. Matching uses exact normalized display names only. An unmatched or ambiguous name receives no person ID. Conflicting values yield no selected value. Every field stays `needs-review`; this contract does not approve or persist anything.

Observation values are untrusted data. Strict schemas reject extra instruction/control fields, and instruction-like text inside a value remains a literal proposed value requiring review. The helper performs no action based on that text.

The synthetic tests cover conflicting facts, duplicate-name ambiguity, unavailable and unauthorized sources, unavailable-source observations, and instruction-like source text. They do not verify live connectors, real assistant memories, GUI review, source truth, a supported client, or approved local save. Reviewed save remains dependent on VLT-04 and VLT-06.
