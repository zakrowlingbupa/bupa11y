// code.js
figma.showUI(__html__, { width: 400, height: 750, title: 'Accessibility Annotator' });

let isScanning = false;

function isActuallyVisible(node) {
  let current = node;
  while (current && current.type !== 'PAGE') {
    if (!current.visible || current.opacity === 0) return false;
    current = current.parent;
  }
  return true;
}

function isInsideFormContainer(node) {
  let parent = node.parent;
  while (parent && parent.type !== 'PAGE') {
    const pName = parent.name.toLowerCase();
    if (pName.includes("input fields") || pName.includes("text fields")) return true;
    parent = parent.parent;
  }
  return false;
}

async function ensureA11yCategoryId() {
  const categories = await figma.annotations.getAnnotationCategoriesAsync();
  const found = categories.find(c => c.label.toLowerCase() === 'accessibility');
  if (found) return found.id;
  const newCat = await figma.annotations.addAnnotationCategoryAsync({ label: 'Accessibility', color: 'PURPLE' });
  return newCat.id;
}

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'open-url') { figma.openExternal(msg.url); }

  if (msg.type === 'run-scan') {
    isScanning = true;
    const suggestions = [];
    const selection = figma.currentPage.selection;
    
    if (selection.length === 0) {
      figma.notify("Select layers to scan first", { error: true });
      figma.ui.postMessage({ type: 'scan-error' });
      return;
    }

    let allNodes = [];
    const gather = (n) => {
      try {
        if (!isActuallyVisible(n)) return;
        const name = n.name.toLowerCase();
        if (name.includes("vector")) return;
        if (name.includes("path") && (!n.children || n.children.length === 0)) return;
        if (isInsideFormContainer(n) && (name.includes("icon") || name.includes("button"))) return;
        allNodes.push(n);
        if (name.includes("icon")) return;
        if ("children" in n) n.children.forEach(gather);
      } catch (e) { console.error(e); }
    };
    selection.forEach(gather);

    const actionWords = ["add", "edit", "change", "remove", "close", "exit", "search", "find"];

    for (let i = 0; i < allNodes.length; i++) {
      if (!isScanning) return;
      const node = allNodes[i];
      const name = node.name.toLowerCase();

      if ((node.type === "COMPONENT" || node.type === "INSTANCE" || node.type === "FRAME") && name.includes("button")) {
        const textNodes = node.findAll(n => n.type === "TEXT");
        const hasActionWord = textNodes.some(t => actionWords.some(word => t.characters.toLowerCase().includes(word)));
        if (hasActionWord) {
          suggestions.push({
            nodeId: node.id, layerName: node.name, title: "Potential Live Region",
            reason: "Buttons that trigger actions often need to announce status changes.",
            wcag: "WCAG 4.1.3", url: "https://www.w3.org/WAI/WCAG21/Understanding/status-messages.html",
            options: [{ label: "Apply Live Region", text: "A dynamic notification must use a live region to announce this change." }]
          });
        }
      }

      if (name.includes("icon") || node.type === "VECTOR") {
        suggestions.push({ 
          nodeId: node.id, layerName: node.name, title: "Icon detected", 
          reason: "Icons need alt-text to convey meaning to screen readers.",
          wcag: "WCAG 1.1.1", url: "https://www.w3.org/WAI/WCAG21/Understanding/non-text-content.html",
          options: [{ label: "Add Alt Text", text: "Text alternative for icon: Add text here" }, { label: "Mark Decorative", text: "This icon should be hidden." }]
        });
      }
      
      if (node.type === "TEXT" && node.fontSize >= 20) {
        suggestions.push({ 
          nodeId: node.id, layerName: node.name, title: "Possible Heading", 
          reason: "Headings allow screen reader users to navigate content efficiently.",
          wcag: "WCAG 1.3.1", url: "https://www.w3.org/WAI/WCAG21/Understanding/info-and-relationships.html",
          options: [{ label: "Apply Heading Tag", text: "This text should be marked up as a heading level (H1-H6)." }]
        });
      }
      
      if (i % 10 === 0 || i === allNodes.length - 1) {
        figma.ui.postMessage({ type: 'scan-progress', progress: Math.round(((i + 1) / allNodes.length) * 100) });
        await new Promise(r => setTimeout(r, 5));
      }
    }
    figma.ui.postMessage({ type: 'display-suggestions', suggestions });
  }

  if (msg.type === 'apply-annotation') {
    const categoryId = await ensureA11yCategoryId();
    const selection = figma.currentPage.selection;
    if (selection.length > 0) {
      selection.forEach(node => {
        node.annotations = [...(node.annotations || []), { labelMarkdown: msg.text, categoryId }];
      });
      figma.notify(`✅ Applied to ${selection.length} layer(s).`);
    }
  }

  if (msg.type === 'focus-node') {
    const node = figma.getNodeById(msg.nodeId);
    if (node) { figma.currentPage.selection = [node]; figma.viewport.scrollAndZoomIntoView([node]); }
  }

  if (msg.type === 'cancel-scan') { isScanning = false; }
};