// Luna's notebook page. All state lives behind /api/notebook; this file keeps no
// second copy of any list and renders only what the service last returned.
import { notebookRequest } from './notebook-client.js';
import { mountLunaAvatar } from './luna/avatar.js';
import { notebookAvatarState } from './luna/presentation.js';
const $ = (selector) => document.querySelector(selector);
const root = $("#notebook");

if (root) {
  let busy = false;
  let timer;
  const status = $("#notebook-status");
  const errorLine = $("#notebook-error");
  const luna = $("#notebook-luna");
  const avatar = mountLunaAvatar(luna, { label: 'Luna with her notebook', size: 'min(60vw, 240px)' });

  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const button = (text, action, label) => {
    const node = el("button", text, "quiet-button");
    node.type = "button";
    if (label) node.setAttribute("aria-label", label);
    node.addEventListener("click", action);
    return node;
  };

  // Success is shown only after the notebook service confirms an applied/read result.
  function play(outcome) {
    clearTimeout(timer);
    avatar.update({ state: notebookAvatarState(outcome) });
    timer = setTimeout(() => {
      avatar.update({ state: "idle" });
    }, 2200);
  }

  async function call(body) {
    if (busy) return null;
    busy = true;
    avatar.update({ state: "working" });
    root.setAttribute("aria-busy", "true");
    errorLine.textContent = "";
    try {
      return await notebookRequest(body);
    } catch {
      errorLine.textContent =
        "Luna could not confirm the result. Reopen the list before trying again.";
      play({ success: false });
      return null;
    } finally {
      busy = false;
      root.removeAttribute("aria-busy");
    }
  }

  function render(book) {
    const host = $("#notebook-lists");
    host.replaceChildren();
    if (!book.lists.length)
      host.append(el("p", "No lists yet. Tell Luna to make one.", "empty"));
    for (const list of book.lists) {
      const card = el("section", undefined, "list-panel");
      card.setAttribute("aria-labelledby", `nb-${list.id}`);
      const title = el("h2", list.name);
      title.id = `nb-${list.id}`;
      const remaining = list.items.filter((item) => !item.completed).length;
      card.append(
        title,
        el(
          "p",
          `${remaining} to do · ${list.items.length - remaining} done`,
          "meta",
        ),
      );
      const rows = el("ul", undefined, "nb-items");
      for (const item of [...list.items].sort(
        (a, b) => a.position - b.position,
      )) {
        const row = el("li", undefined, item.completed ? "completed" : "");
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = item.completed;
        box.setAttribute(
          "aria-label",
          `${item.text}, ${item.completed ? "done" : "not done"}`,
        );
        box.addEventListener("change", () => {
          const completed = box.checked;
          box.checked = item.completed;
          run({
            op: "complete_item",
            list: list.id,
            item: item.id,
            completed,
          });
        });
        const label = [
          item.quantity
            ? `${item.quantity}${item.unit ? ` ${item.unit}` : ""}`
            : "",
          item.text,
        ]
          .filter(Boolean)
          .join(" ");
        row.append(box, el("span", label));
        if (item.category) row.append(el("small", item.category));
        if (item.notes) row.append(el("small", item.notes));
        const author = names.get(item.updatedBy?.id);
        if (author) row.append(el("small", `by ${author}`));
        row.append(
          button(
            "Edit",
            () => {
              const next = prompt("Edit item", item.text);
              if (next && next.trim())
                run({
                  op: "edit_item",
                  list: list.id,
                  item: item.id,
                  patch: { text: next.trim() },
                });
            },
            `Edit ${item.text}`,
          ),
          button(
            "Remove",
            () => run({ op: "remove_item", list: list.id, item: item.id }),
            `Remove ${item.text}`,
          ),
        );
        rows.append(row);
      }
      const add = el("form", undefined, "form-row");
      const input = document.createElement("input");
      input.type = "text";
      input.maxLength = 160;
      input.setAttribute("aria-label", `Add to ${list.name}`);
      const submit = el("button", "Add", "quiet-button");
      submit.type = "submit";
      add.append(input, submit);
      add.addEventListener("submit", (event) => {
        event.preventDefault();
        if (input.value.trim())
          run({
            op: "add_items",
            list: list.id,
            items: [{ text: input.value.trim() }],
          });
      });
      card.append(
        rows,
        add,
        button(
          "Rename list",
          () => {
            const next = prompt("Rename list", list.name);
            if (next && next.trim())
              run({ op: "rename_list", list: list.id, name: next.trim() });
          },
          `Rename ${list.name}`,
        ),
        button(
          "Delete list",
          () => {
            if (
              confirm(`Delete ${list.name} and its ${list.items.length} items?`)
            )
              run({ op: "delete_list", list: list.id, confirmed: true });
          },
          `Delete ${list.name}`,
        ),
      );
      host.append(card);
    }
  }

  // People come from the household vault. The choice is attribution only.
  const names = new Map();
  const memberRow = $("#notebook-member-row");
  const memberSelect = $("#notebook-member");
  function showMembers(members, current) {
    names.clear();
    for (const member of members) names.set(member.id, member.name);
    memberRow.hidden = members.length === 0;
    memberSelect.replaceChildren(
      ...[{ id: "", name: "The household" }, ...members].map((member) => {
        const option = el("option", member.name);
        option.value = member.id;
        return option;
      }),
    );
    memberSelect.value = current ?? "";
  }
  memberSelect.addEventListener("change", async () => {
    const data = await call({
      action: "member",
      memberId: memberSelect.value || null,
    });
    if (data) show(data, data.reply);
  });

  function show(data, announce) {
    if (data.members) showMembers(data.members, data.member);
    if (data.notebook) render(data.notebook);
    play(data.avatar);
    if (announce !== undefined) status.textContent = announce;
  }

  async function run(operation) {
    const data = await call({ action: "op", operation });
    if (data) show(data, data.reply);
  }

  $("#notebook-say").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("#notebook-say-input");
    const text = input.value.trim();
    if (!text) return;
    const data = await call({ action: "say", text });
    if (!data) return;
    input.value = "";
    show(
      data,
      data.handled ? data.reply : "That isn't something my notebook can do.",
    );
  });

  $("#notebook-new").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("#notebook-new-name");
    if (!input.value.trim()) return;
    await run({ op: "create_list", name: input.value.trim() });
    input.value = "";
  });

  async function refresh() {
    const data = await call({ action: "snapshot" });
    if (data) show(data);
  }
  window.addEventListener("hashchange", () => {
    if (location.hash === "#notebook") refresh();
  });
  const refreshTimer = setInterval(() => {
    if (!document.hidden && location.hash === '#notebook' && !busy
      && !(root.contains(document.activeElement)
        && document.activeElement.matches('input:not([type="checkbox"]), textarea, select'))) refresh();
  }, 3000);
  window.addEventListener('pagehide', () => { clearTimeout(timer); clearInterval(refreshTimer); avatar.dispose(); }, { once: true });
  if (location.hash === "#notebook") refresh();
  // Voice and other devices write the same vault. Refresh only while viewing
  // it, without replacing an input or a control the user is working with.
}
