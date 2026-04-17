import { useEffect } from 'react';
import { translateOperatorUiTextToEnglish } from '../i18n/operatorUiTranslations';

const TEXT_NODE_SKIP_SELECTOR = [
  'script',
  'style',
  'code',
  'pre',
  'textarea',
  'input',
  '[contenteditable="true"]',
  '[data-no-ui-translate="true"]'
].join(',');

const ATTRIBUTE_SKIP_SELECTOR = [
  'script',
  'style',
  'code',
  'pre',
  '[contenteditable="true"]',
  '[data-no-ui-translate="true"]'
].join(',');

const shouldUseEnglishUi = (user) => {
  const role = String(user?.role || '').toUpperCase();
  const language = String(user?.chat_language || 'RU').toUpperCase();
  return role === 'OPERATOR' && language === 'EN';
};

const shouldSkipBySelector = (node, selector) => {
  const element = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  if (!element) return true;
  return Boolean(element.closest(selector));
};

const shouldSkipTextNode = (node) => shouldSkipBySelector(node, TEXT_NODE_SKIP_SELECTOR);
const shouldSkipAttributeNode = (node) => shouldSkipBySelector(node, ATTRIBUTE_SKIP_SELECTOR);

const translateElementAttributes = (element) => {
  if (!element || shouldSkipAttributeNode(element)) return;
  ['placeholder', 'title', 'aria-label'].forEach((attr) => {
    const currentValue = element.getAttribute(attr);
    if (!currentValue) return;
    const translated = translateOperatorUiTextToEnglish(currentValue);
    if (translated !== currentValue) {
      element.setAttribute(attr, translated);
    }
  });
};

const translateTextNodesUnder = (rootNode) => {
  if (!rootNode) return;

  const rootElement = rootNode.nodeType === Node.ELEMENT_NODE ? rootNode : rootNode.parentElement;
  if (rootElement && shouldSkipTextNode(rootElement)) return;

  if (rootNode.nodeType === Node.ELEMENT_NODE) {
    translateElementAttributes(rootNode);
  }

  const walker = document.createTreeWalker(
    rootNode,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (!node?.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
        if (shouldSkipTextNode(node)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  let currentNode = walker.nextNode();
  while (currentNode) {
    const currentValue = currentNode.nodeValue;
    const translated = translateOperatorUiTextToEnglish(currentValue);
    if (translated !== currentValue) {
      currentNode.nodeValue = translated;
    }
    currentNode = walker.nextNode();
  }

  if (rootNode.nodeType === Node.ELEMENT_NODE) {
    rootNode.querySelectorAll('[placeholder],[title],[aria-label]').forEach(translateElementAttributes);
  }
};

export const useOperatorUiAutoTranslation = (user) => {
  useEffect(() => {
    if (!shouldUseEnglishUi(user)) return undefined;

    // Use document.body so translated text also covers portal-based UI
    // (e.g. CustomSelect dropdowns, tooltips, modals).
    const root = document.body;
    if (!root) return undefined;

    let isApplying = false;
    let frameId = null;

    const applyTranslations = () => {
      if (isApplying) return;
      isApplying = true;
      try {
        translateTextNodesUnder(root);
      } finally {
        isApplying = false;
      }
    };

    const scheduleTranslation = () => {
      if (frameId !== null) return;
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        applyTranslations();
      });
    };

    applyTranslations();

    const observer = new MutationObserver((mutations) => {
      if (isApplying) return;
      let shouldProcess = false;
      for (const mutation of mutations) {
        if (mutation.type === 'characterData' || mutation.type === 'attributes') {
          shouldProcess = true;
          break;
        }
        if (mutation.type === 'childList' && (mutation.addedNodes?.length || mutation.removedNodes?.length)) {
          shouldProcess = true;
          break;
        }
      }
      if (shouldProcess) {
        scheduleTranslation();
      }
    });

    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['placeholder', 'title', 'aria-label']
    });

    return () => {
      observer.disconnect();
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, [user?.id, user?.role, user?.chat_language]);
};
