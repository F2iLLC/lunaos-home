import { mountLunaAvatar, LUNA_STATES } from '../../src/luna/avatar.js';

// The studio and Home use the same geometry and appearance. No second Liam rig.
export const CHARACTERS = Object.freeze({
  luna: Object.freeze({ id: 'luna', name: 'Luna', base: 'luna', animations: 'shared' }),
  liam: Object.freeze({ id: 'liam', name: 'Liam', base: 'luna', hair: 'fluffy-periwinkle', outfit: 'science', animations: 'shared' }),
});
export { LUNA_STATES as CHARACTER_STATES };

export function mountCharacter(host, { character = 'luna', ...props } = {}) {
  if (!Object.hasOwn(CHARACTERS, character)) throw new TypeError('Unknown character');
  const validate = next => {
    if ('character' in next) throw new TypeError('Character is fixed per mount');
    if (character === 'liam' && next.outfit && next.outfit !== 'home') throw new TypeError('Liam uses the home wardrobe');
  };
  validate(props);
  const controller = mountLunaAvatar(host, { scienceOutfit: character === 'liam', ...props, character, label: CHARACTERS[character].name });
  return {
    element: controller.element,
    update(next = {}) { validate(next); controller.update({ ...next, character }); },
    dispose() { controller.dispose(); },
  };
}
