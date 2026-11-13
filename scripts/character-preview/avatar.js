import { mountLunaAvatar, LUNA_STATES } from '../../src/luna/avatar.js';

// Development-only appearance assets. No assistant, voice or account identity.
export const CHARACTERS = Object.freeze({
  luna: Object.freeze({ id: 'luna', name: 'Luna', base: 'luna', animations: 'shared' }),
  liam: Object.freeze({ id: 'liam', name: 'Liam', base: 'luna', hair: 'fluffy-blue', outfit: 'blue-hoodie', animations: 'shared' }),
});
export { LUNA_STATES as CHARACTER_STATES };

const hair = `<path d="M77 151Q66 132 71 111L62 115Q64 94 84 83L74 79Q88 61 113 62L109 51Q127 48 143 57Q139 39 154 29Q151 47 169 50Q187 40 202 51L197 60Q222 58 235 78L228 80Q250 94 249 116L241 111Q250 137 241 155L228 145 222 123Q207 127 196 112L199 125Q175 119 159 95Q149 118 128 126L133 112Q113 130 98 128L92 148 85 143 84 165Z" fill="#48b6ff"/>
  <path d="M74 113Q77 94 92 85L84 83Q106 65 125 70L120 62Q145 66 158 80Q138 75 124 90 104 111 91 110L85 143 79 139Z M204 74Q237 84 240 111L233 109Q244 136 239 145L229 139 222 118Q210 118 201 108L204 117 196 112Q182 101 174 88Q196 103 212 104Z" fill="#2387dc" stroke="none"/>
  <path d="M99 82Q116 70 134 78M170 66Q184 58 198 67" fill="none" stroke="#b1e9ff" stroke-width="6"/>
  <path d="M147 59Q147 48 153 43" fill="none" stroke="#b1e9ff" stroke-width="3"/>`;
const hoodie = `<path d="M123 238Q160 223 197 238L207 302Q160 318 113 302Z" fill="#51b4f4"/>
  <path d="M116 295Q160 307 204 295L207 309Q160 322 113 309Z" fill="#edfaff"/>
  <path d="M127 303 126 312M142 306 141 315M178 306 179 315M193 303 194 312" stroke="#9acfe8" stroke-width="2"/>
  <path d="M121 233Q131 214 160 237 189 214 199 233L180 250 160 242 140 250Z" fill="#2387dc"/>
  <path d="M125 231Q141 230 159 242 178 230 195 231" fill="none" stroke="#f5fcff" stroke-width="6"/>
  <path d="M141 244 138 267M179 244 182 267" fill="none" stroke="#f5fcff" stroke-width="4"/>
  <path d="M133 280 126 292Q160 303 194 292L187 280" fill="#3198e2"/>
  <path d="M151 258H165L158 269H170L152 284 156 272H148Z" fill="#fff4b5" stroke-width="1.8"/>`;
const sneakers = `<path d="M123 300V324H145V300M175 300V324H197V300" fill="#fff0df"/>
  <path d="M123 314H145V325H123ZM175 314H197V325H175Z" fill="#f5fcff"/>
  <path d="M117 320Q132 313 149 321L151 343Q136 351 112 345L114 330Z M171 321Q188 313 203 320L206 330 208 345Q184 351 169 343Z" fill="#48b6ff"/>
  <path d="M113 336Q130 330 149 335L151 343Q132 350 112 345ZM171 335Q189 330 207 336L208 345Q189 350 169 343Z" fill="#d9f3ff"/>
  <path d="M112 342Q129 348 151 341V349Q130 355 111 349ZM169 341Q190 348 208 342L209 349Q190 355 169 349Z" fill="#fff8ff"/>
  <path d="M124 324 140 326M123 329 140 331M180 326 196 324M180 331 197 329" fill="none" stroke="#fff" stroke-width="3"/>`;

function applyLiam(svg) {
  // Apply appearance once. Keep the authoritative face, head pivots, hands,
  // gestures, mask geometry, effects and ALL animation selectors intact.
  for (const tail of svg.querySelectorAll('.l2-pigtail')) tail.parentElement.parentElement.remove();
  svg.querySelector('.l2-front-hair').innerHTML = hair;
  svg.querySelector('.l2-accessories').replaceChildren();
  svg.querySelector('.l2-outfit-home').innerHTML = hoodie;
  svg.querySelector('.l2-feet').innerHTML = sneakers;
  for (const sleeve of svg.querySelectorAll('.l2-sleeve')) sleeve.setAttribute('fill', '#69c3ff');
  for (const cuff of svg.querySelectorAll('.l2-arm path[fill="#f6d4ee"], .l2-hand-think path[fill="#f6d4ee"]')) cuff.setAttribute('fill', '#f5fcff');
  for (const shape of svg.querySelectorAll('.l2-sleep-mask path')) {
    const colors = { '#9b79cb': '#2387dc', '#b792ee': '#58b6f1', '#f0d9ff': '#d9f3ff' };
    for (const attr of ['fill', 'stroke']) if (colors[shape.getAttribute(attr)]) shape.setAttribute(attr, colors[shape.getAttribute(attr)]);
  }
}

export function mountCharacter(host, { character = 'luna', ...props } = {}) {
  if (!Object.hasOwn(CHARACTERS, character)) throw new TypeError('Unknown character');
  const config = CHARACTERS[character];
  const validate = next => {
    if ('character' in next) throw new TypeError('Character is fixed per mount');
    if (character === 'liam' && next.outfit && next.outfit !== 'home') throw new TypeError('Liam has a home hoodie only');
  };
  validate(props);
  const controller = mountLunaAvatar(host, { ...props, label: config.name });
  if (character === 'liam') applyLiam(controller.element);
  controller.element.dataset.character = character;
  return {
    element: controller.element,
    update(next = {}) { validate(next); controller.update(next); },
    dispose: controller.dispose,
  };
}
