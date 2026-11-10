// Luna's notebook page. All state lives behind /api/notebook; this file keeps no
// second copy of any list and renders only what the service last returned.
const $ = (selector) => document.querySelector(selector);
const root = $("#notebook");

if (root) {
  let busy = false;
  let timer;
  const status = $("#notebook-status");
  const errorLine = $("#notebook-error");
  const luna = $("#notebook-luna");

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

  // The animation attribute is set only from a server-reported outcome.
  function play(avatar) {
    clearTimeout(timer);
    luna.dataset.animation = avatar?.animation ?? "idle";
    luna.dataset.success = avatar?.success ? "yes" : "no";
    timer = setTimeout(() => {
      luna.dataset.animation = "idle";
    }, 2200);
  }

  async function call(body) {
    if (busy) return null;
    busy = true;
    root.setAttribute("aria-busy", "true");
    errorLine.textContent = "";
    try {
      const response = await fetch("/api/notebook", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Home-Preview": "1" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        errorLine.textContent =
          data.error ?? "Luna could not reach her notebook.";
        play({ animation: "puzzled" });
        return null;
      }
      return data;
    } catch {
      errorLine.textContent =
        "Luna could not reach her notebook. Nothing was changed.";
      play({ animation: "puzzled" });
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
        box.addEventListener("change", () =>
          run({
            op: "complete_item",
            list: list.id,
            item: item.id,
            completed: box.checked,
          }),
        );
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
    if (data.avatar) play(data.avatar);
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
  if (location.hash === "#notebook") refresh();
}
