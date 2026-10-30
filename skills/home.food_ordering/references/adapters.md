# Restaurant adapters

An adapter holds restaurant-specific facts the generic procedure cannot know. Keep adapters short and procedural. No screenshots, logs, personal data, or payment data. Use synthetic examples only.

## Adapter template

```
adapter: <merchant slug>
ordering_entry: <official URL pattern for ordering>
authority_note: <which page is authoritative when pages disagree>
fulfillment: <pickup | delivery | both; where the toggle lives>
popups: <known pop-ups and the safe dismissal>
menu_shape: <how entrees are structured>
kid_friendly: <items usually suitable for children>
spice_controls: <where heat is chosen; the mild option>
fees: <known fee behavior, if stable>
verified: <date and skill version>
```

## Example (fictional)

```
adapter: example-taqueria
ordering_entry: https://order.example.test/
authority_note: the location page may say ordering is closed while the ordering site is open; trust the ordering site
fulfillment: pickup and delivery toggle at the top of the menu
popups: accept-only cookie banner (dismiss instead), rewards pop-up (close)
menu_shape: pick a main, then base, protein, toppings; chips, sides, drinks after
kid_friendly: cheese quesadilla, plain tacos
spice_controls: salsa chosen per item; pick mild or none
fees: none observed for pickup
verified: never (fictional example)
```
