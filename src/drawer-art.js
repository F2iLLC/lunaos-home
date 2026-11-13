import { lunaAvatarMarkup } from './luna/avatar.js';

// Decorative, local vector artwork. Never substitutes for a result or a control.
const paths = {
  moon: '<path d="M31 5C8 6 0 29 14 44c12 13 32 9 40-6C27 45 15 23 31 5Z" fill="#ffe6ac"/><path d="M17 13Q4 35 26 46" stroke="#fff6d7"/><path d="M44 13c-7-9-14 4 0 12 15-9 7-21 0-12Z" fill="#e7cdfb"/>',
  sparkle: '<path d="M28 4Q27 26 9 29q18 1 19 22 3-21 20-22Q30 26 28 4Z" fill="#fff0c4"/>',
  heart: '<path d="M28 15C10-5-5 23 28 44 61 23 46-5 28 15Z" fill="#ffe5ed"/>',
  pencil: '<g transform="rotate(32 28 28)"><path d="M18 9q10-13 20 0v33L28 55 18 42Z" fill="#ceabf7"/><path d="M18 13h20M18 18h20M18 42l10 2 10-2M25 18v24"/><path d="m18 42 10 13 10-13-10 2Z" fill="#fff0cf"/><path d="m24 50 4 5 4-5" fill="#5e4484"/><path d="M32 24a7 7 0 1 0 0 12 8 8 0 0 1 0-12Z" fill="#ffe8a8"/></g>',
  drink: '<g transform="rotate(-12 28 28)"><path d="M10 21h36l-5 32H15Z" fill="#fff7f6"/><ellipse cx="28" cy="20" rx="19" ry="6" fill="#e8d7ff"/><path d="M20 14 17 1h-6m17 14 6-12M10 25l34 1"/><path d="M28 35c-10-10-15 5 0 12 15-8 9-22 0-12Z" fill="#f3c7e7"/></g>',
  bag: '<path d="m11 25-4-9 5-2-2-6 6 2 3-6 6 5 2-5 8 3-2 9 6-7 4 3 5-2 3 6-7 12" fill="#e7d8f8"/><path d="m6 23 40 4 7-3-3 30-10 2-37-8Z" fill="#fff6f3"/><path d="m46 27-6 29M6 23l34 8 13-7"/><path d="M23 37C9 24 5 42 23 49c18-9 13-26 0-12Z" fill="#ffddec"/><path d="m17 11 4 14m15-9-4 12" stroke="#b28bcc"/>',
  flask: '<path d="M22 4h14v5h-2v17l17 23q3 6-4 6H10q-6 0-3-6l17-23V9h-2Z" fill="#f3f6ff"/><path d="m19 36-9 15h37L37 36q-8 6-18 0Z" fill="#aaaaf0" stroke="none"/><path d="m22 42 3 3m10 1 2-2" stroke="#fff" stroke-width="3"/><circle cx="17" cy="20" r="2" fill="#aab5ef"/>',
  atom: '<g fill="none"><ellipse cx="28" cy="28" rx="25" ry="9"/><ellipse cx="28" cy="28" rx="25" ry="9" transform="rotate(60 28 28)"/><ellipse cx="28" cy="28" rx="25" ry="9" transform="rotate(120 28 28)"/></g><circle cx="28" cy="28" r="6" fill="#ffe8a4" stroke="none"/><circle cx="46" cy="9" r="3" fill="#c6d8ff"/>',
  planet: '<g transform="rotate(-23 28 28)"><circle cx="28" cy="28" r="19" fill="#ddd9ff"/><path d="M17 14q7 9 24 8M11 30q16 12 32 3M24 44q10 0 18-6" fill="none" stroke="#b2afe9" stroke-width="5"/><ellipse cx="28" cy="29" rx="29" ry="8" fill="none"/><path d="M1 29q10 16 54 0" fill="none" stroke="#fff8ea" stroke-width="3"/></g>',
  books: '<path d="m6 32 30-8 18 10-32 10-16-6q-7-4 0-6Z" fill="#c2c5fa"/><path d="m6 38 16 7 31-10v10l-31 10-16-7q-5-5 0-10Z" fill="#fff8f0"/><path d="m22 45-1 10M9 41l9 4m9 4 21-6"/><path d="m7 9 29-6 18 9-32 9-15-6q-7-3 0-6Z" fill="#a6bcfa"/><path d="m7 15 15 7 31-10v11l-31 9-15-6q-5-5 0-11Z" fill="#fff8f0"/><path d="m22 22-1 10M10 18l9 4m8 4 21-6"/>',
  lists: '<rect x="11" y="11" width="34" height="40" rx="4"/><path d="m19 31 8 8L48 9M21 7v8m14-8v8"/>',
  vault: '<rect x="11" y="25" width="34" height="27" rx="4"/><path d="M19 25V14a9 9 0 0 1 18 0v11"/><circle cx="28" cy="36" r="3"/><path d="M28 39v5"/>',
  calendar: '<rect x="7" y="12" width="43" height="39" rx="5"/><path d="M7 24h43M18 6v13M39 6v13m-22 9 3 3m14-3 3 3m-20 7 3 3m14-3 3 3"/>',
  settings: '<path d="m22 6 12 0 2 7 6 4 7-1 6 11-5 5-1 6 3 6-10 7-6-4-7 0-5 5-11-6 1-7-3-6-6-3 4-12 7 0 5-5Z"/><circle cx="29" cy="29" r="10"/>',
  calculator: '<rect x="10" y="4" width="36" height="49" rx="6"/><path d="M17 12h22v10H17Z" fill="#d9edff"/><path d="M18 30h3m6 0h3m6 0h3m-21 7h3m6 0h3m6 0h3m-21 7h3m6 0h3m6 0h3" stroke-width="3"/>',
  graph: '<path d="M2 30h8l6-17 9 32 10-39 8 30 5-13h6"/>',
  notebook: '<path d="M28 13Q13 3 3 10v39q12-7 25 3 13-10 25-3V10Q41 3 28 13Zm0 0v39"/>',
};
export const drawerIcon = name => `<svg viewBox="0 0 58 58" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">${paths[name] || ''}</svg>`;

export function drawerDecorations() {
  const sticker = (character, state, cls) => `<span class="drawer-sticker ${cls}">${lunaAvatarMarkup({ character, scienceOutfit: true, state, reducedMotion: true }).replace('viewBox="0 0 320 360"', 'viewBox="0 45 320 185"').replace('role="img"', 'aria-hidden="true"')}<svg class="sticker-paws" viewBox="0 0 100 20" aria-hidden="true"><path d="M19 16q-5-15 8-14 13-1 8 14Zm46 0q-5-15 8-14 13-1 8 14Z" fill="#fff0df" stroke="currentColor" stroke-width="2"/></svg></span>`;
  const motif = (name, cls) => `<span class="drawer-motif ${cls}">${drawerIcon(name)}</span>`;
  return `<div class="drawer-illustrations" aria-hidden="true">
    <div class="notebook-illustrations">${motif('moon', 'art-moon')}${motif('sparkle', 'art-star')}${motif('drink', 'art-drink')}${motif('bag', 'art-bag')}${motif('heart', 'art-heart')}${motif('pencil', 'art-pencil')}${sticker('luna', 'happy', 'art-peek')}${sticker('luna', 'sleeping', 'art-sleep')}</div>
    <div class="calculator-illustrations">${motif('atom', 'art-atom')}${motif('planet', 'art-planet')}${motif('flask', 'art-flask')}${motif('books', 'art-books')}</div>
  </div>`;
}

export function displaySticker() {
  return `<span class="drawer-display-sticker" aria-hidden="true">${lunaAvatarMarkup({character:'liam',scienceOutfit:true,state:'listening',reducedMotion:true}).replace('viewBox="0 0 320 360"','viewBox="0 45 320 185"').replace('role="img"','aria-hidden="true"')}</span>`;
}
