(function () {
  const { escapeHtml, formatTime, renderBody, previewOf, titleOf, showToast, post, iconButton, setIcon } =
    window.Zhihu;

  const listPage = document.getElementById("list-page");
  const detailPage = document.getElementById("detail-page");
  const listEl = document.getElementById("list");
  const listLoading = document.getElementById("list-loading");
  const moreBtn = document.getElementById("btn-more");
  const detailEl = document.getElementById("detail");
  const editorBtn = document.getElementById("btn-editor");

  moreBtn.addEventListener("click", () => post("loadMore"));
  document.getElementById("btn-back").addEventListener("click", showList);
  document.getElementById("btn-editor").addEventListener("click", () => post("openInEditor"));

  listEl.addEventListener("click", (e) => {
    const item = e.target.closest(".item");
    if (!item) return;
    post("openItem", { id: item.dataset.id, itemType: item.dataset.type });
  });

  window.addEventListener("message", (e) => {
    const msg = e.data || {};
    switch (msg.type) {
      case "listLoading":
        listLoading.classList.remove("hidden");
        if (msg.reset) {
          listEl.innerHTML = "";
          moreBtn.classList.add("hidden");
        }
        break;
      case "listResult":
        listLoading.classList.add("hidden");
        if (msg.status && !msg.status.logged_in) {
          listEl.innerHTML =
            '<div class="empty">' + escapeHtml(msg.status.message || "未登录") + "</div>";
          moreBtn.classList.add("hidden");
        } else {
          renderList(msg.data || []);
          moreBtn.classList.toggle("hidden", !msg.hasMore);
        }
        showList();
        break;
      case "detailLoading":
        showDetail();
        editorBtn.disabled = true;
        detailEl.innerHTML = renderDetailShell(msg.item, true);
        break;
      case "detailResult":
        editorBtn.disabled = false;
        detailEl.innerHTML = renderDetailShell(msg.item, false, msg.detail);
        bindQuestionToggle();
        break;
      case "error":
        listLoading.classList.add("hidden");
        showToast(msg.message || "出错了");
        break;
    }
  });

  function showList() {
    listPage.classList.remove("hidden");
    detailPage.classList.add("hidden");
  }

  function showDetail() {
    listPage.classList.add("hidden");
    detailPage.classList.remove("hidden");
    window.scrollTo(0, 0);
  }

  function renderList(items) {
    if (!items.length) {
      listEl.innerHTML = '<div class="empty">暂无推荐，确认后端已登录后刷新</div>';
      return;
    }
    listEl.innerHTML = items
      .map((item) => {
        const title = titleOf(item);
        const preview = previewOf(item);
        return (
          '<div class="item" data-id="' +
          escapeHtml(String(item.id)) +
          '" data-type="' +
          escapeHtml(item.type || "") +
          '">' +
          '<div class="item-title"><span class="badge">' +
          escapeHtml(item.type || "") +
          "</span>" +
          escapeHtml(title) +
          "</div>" +
          '<div class="item-preview">' +
          escapeHtml(preview) +
          "</div></div>"
        );
      })
      .join("");
  }

  function renderDetailShell(item, loading, detail) {
    const title = (detail && detail.title) || titleOf(item || {});
    const author = (detail && detail.author) || (item && item.author) || "匿名";
    const type = (detail && detail.type) || (item && item.type) || "";
    const url = item && item.url;
    let question = "";
    if (detail && detail.question_detail) {
      question =
        iconButton({
          id: "question-toggle",
          icon: "more",
          title: "展开问题补充",
          className: "question-toggle",
        }) +
        '<div class="question-body" id="question-body">' +
        window.Zhihu.cleanHtml(detail.question_detail) +
        "</div>";
    }
    const body = loading
      ? '<div class="loading">加载全文...</div>'
      : '<div class="body">' + renderBody(detail) + "</div>";
    const metaParts = [escapeHtml(author), escapeHtml(type)];
    if (item && item.created_time) metaParts.push(formatTime(item.created_time));
    const linkBtn = url ? iconButton({ icon: "link", title: "打开原链接", url }) : "";
    return (
      '<article class="article"><h2>' +
      escapeHtml(title) +
      '</h2><div class="meta meta-row">' +
      '<span>' +
      metaParts.join(" · ") +
      "</span>" +
      linkBtn +
      "</div>" +
      question +
      body +
      "</article>"
    );
  }

  function bindQuestionToggle() {
    const btn = document.getElementById("question-toggle");
    const body = document.getElementById("question-body");
    if (!btn || !body) return;
    btn.addEventListener("click", () => {
      body.classList.toggle("open");
      const open = body.classList.contains("open");
      setIcon(btn, open ? "collapse" : "more", open ? "收起问题补充" : "展开问题补充");
    });
  }

  post("ready");
})();
