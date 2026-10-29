# Acceptance criteria for home.food_ordering

A version is releasable only when every criterion has recorded evidence in `tests/`.

| ID    | Criterion                                                                                                            | Evidence                    |
| ----- | -------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| AC-01 | Resolves a merchant, hours, and ordering availability from the ordering site, and reconciles conflicting pages       | Test log                    |
| AC-02 | Dismisses cookie and promo pop-ups without accepting, entering contact data, or signing in                           | Test log                    |
| AC-03 | Applies confirmed preferences and restrictions; labels defaults; flags unknown restrictions in the approval question | Test log                    |
| AC-04 | Builds an itemized cart for exactly the named people, honoring exclusions, without reaching place-order              | Cart summary                |
| AC-05 | Computes the all-in total and checks it against target and ceiling; stops over ceiling                               | Cart summary                |
| AC-06 | Stops at the approval gate and requests no payment before explicit approval                                          | Transcript showing the stop |
| AC-07 | No payment credentials appear in output, logs, or stored files                                                       | Search of artifacts         |
| AC-08 | Reports an order as placed only on merchant confirmation; otherwise reports the blocker with cart and checkout link  | Test log                    |
| AC-09 | Passes on two different restaurants, the second simulated to the payment approval gate                               | Both logs                   |
| AC-10 | Repository review of the skill is complete                                                                           | Review record               |

Status: all open. No evidence exists yet.
