# Learn about me: typed profile draft

`lib/profile-draft.js` defines a bounded, strict contract for a proposed profile assembled from observations that are already authorized by a caller. The helper is pure: it does not query assistant memory, email, calendars, or another source; it does not call a model or save records.

The input carries explicit source coverage and candidate people. Unavailable and unauthorized sources remain visible in the output, and an observation is rejected unless its source is declared available. The output retains every candidate person, including candidates with no field observations. Each field's evidence retains its source ID, source reference, observation timestamp, direct/inferred provenance, and observed value. Matching uses normalized display names only. An unmatched or ambiguous name receives no person ID. Case-distinct values remain conflicting; a selected value must agree with its evidence, and each person/field-key group appears once. Every field stays `needs-review`; this contract does not approve or persist anything.

Observation values are untrusted data. Strict schemas reject extra instruction/control fields, and instruction-like text inside a value remains a literal proposed value requiring review. The helper performs no action based on that text.

The synthetic tests cover conflicting and corroborating facts, duplicate-name ambiguity, candidate retention without observations, per-observation provenance, output-schema consistency, unavailable and unauthorized sources, unavailable-source observations, and instruction-like source text. They do not verify live connectors, real assistant memories, GUI review, source truth, a supported client, or approved local save. Reviewed save remains dependent on VLT-04 and VLT-06.
