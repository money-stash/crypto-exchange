import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import EmojiPicker from 'emoji-picker-react';
import { Upload, MessageCircleWarning } from 'lucide-react';
import { toast } from 'react-toastify';

const TelegramTextEditor = ({ value, onChange, placeholder, maxLength = 4096, disabled = false, hideAttachments = false, disabledText = 'Отправка рассылки...' }) => {
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const emojiPickerRef = useRef(null);

  const MAX_ATTACHMENTS = 10;
  const MAX_GIF_ATTACHMENTS = 1;

  // закрываем emoji picker при клике вне его области
  useEffect(() => {
    const handleClickOutside = (event) => {
      // если picker открыт, проверяем клик
      if (showEmojiPicker && emojiPickerRef.current) {
        // проверяем что клик НЕ внутри picker и НЕ на кнопке эмодзи
        const isInsidePicker = emojiPickerRef.current.contains(event.target);
        const isEmojiButton = event.target.closest('button[title="Эмодзи"]');
        
        if (!isInsidePicker && !isEmojiButton) {
          setShowEmojiPicker(false);
        }
      }
    };

    const handleEscapeKey = (event) => {
      if (event.key === 'Escape' && showEmojiPicker) {
        setShowEmojiPicker(false);
      }
    };

    // добавляем обработчики только когда picker открыт
    if (showEmojiPicker) {
      // используем capture phase для более надежного перехвата
      document.addEventListener('mousedown', handleClickOutside, true);
      document.addEventListener('keydown', handleEscapeKey);
      
      return () => {
        document.removeEventListener('mousedown', handleClickOutside, true);
        document.removeEventListener('keydown', handleEscapeKey);
      };
    }
  }, [showEmojiPicker]);

  // преобразуем разметку в HTML для отображения
  const convertMarkdownToHtml = (text) => {
    // если текст уже содержит HTML теги, возвращаем как есть
    if (/<[a-z][\s\S]*>/i.test(text)) {
      return text;
    }
    
    // иначе преобразуем старый Markdown в HTML (для обратной совместимости)
    let html = text
      // сначала обрабатываем ссылки [text](url)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-blue-500 underline">$1</a>')
      // подчеркнутый __text__ (двойное подчеркивание должно быть до одинарного)
      .replace(/__([^_]+?)__/g, '<u>$1</u>')
      // код `text`
      .replace(/`([^`]+?)`/g, '<code class="bg-gray-100 px-1 rounded text-sm">$1</code>')
      // зачеркнутый ~text~ (нежадный захват для вложенной разметки)
      .replace(/~([^~]+?)~/g, '<del>$1</del>')
      // жирный текст *text*
      .replace(/\*([^*]+?)\*/g, '<strong>$1</strong>')
      // курсив _text_ (одинарное подчеркивание после двойного)
      //.replace(/_([^_]+?)_/g, '<em>$1</em>')
      // переносы строк
      .replace(/\n/g, '<br>');
    
    return html;
  };

  // синхронизация с внешним значением
  useEffect(() => {
    if (textareaRef.current) {
      const currentHtml = textareaRef.current.innerHTML;
      const expectedHtml = convertMarkdownToHtml(value || '');
      if (currentHtml !== expectedHtml) {
        textareaRef.current.innerHTML = expectedHtml;
      }
    }
  }, [value]);

  // обработчик выбора эмодзи
  const onEmojiClick = (emojiData) => {
    if (textareaRef.current) {
      // фокусируемся на редакторе
      textareaRef.current.focus();
      
      const selection = window.getSelection();
      let range;
      
      if (selection.rangeCount > 0) {
        range = selection.getRangeAt(0);
        // убеждаемся что range находится внутри нашего редактора
        if (!textareaRef.current.contains(range.commonAncestorContainer)) {
          range = document.createRange();
          range.selectNodeContents(textareaRef.current);
          range.collapse(false);
        }
      } else {
        // если нет выделения, создаем range в конце редактора
        range = document.createRange();
        range.selectNodeContents(textareaRef.current);
        range.collapse(false);
      }
      
      // создаем текстовый узел с эмодзи
      const emojiNode = document.createTextNode(emojiData.emoji);
      range.insertNode(emojiNode);
      
      // перемещаем курсор после эмодзи
      range.setStartAfter(emojiNode);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      
      // обновляем значение
      const telegramHtml = convertHtmlToMarkdown(textareaRef.current.innerHTML);
      onChange(telegramHtml, attachments);
      
      // закрываем picker после выбора эмодзи
      setShowEmojiPicker(false);
    }
  };

  // применяем форматирование к выделенному тексту
  const applyFormatting = (formatType) => {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    let selectedText = range.toString();
    
    if (!selectedText) return;

    // сохраняем инфу о пробелах до и после выделения
    const startContainer = range.startContainer;
    const endContainer = range.endContainer;
    const startOffset = range.startOffset;
    const endOffset = range.endOffset;
    
    // проверяем пробелы до и после выделения
    let beforeSpace = '';
    let afterSpace = '';
    
    if (startContainer.nodeType === Node.TEXT_NODE && startOffset > 0) {
      const prevChar = startContainer.textContent[startOffset - 1];
      if (prevChar === ' ') {
        beforeSpace = '';
      }
    }
    
    if (endContainer.nodeType === Node.TEXT_NODE && endOffset < endContainer.textContent.length) {
      const nextChar = endContainer.textContent[endOffset];
      if (nextChar === ' ') {
        afterSpace = '';
      }
    }

    // создаем элемент для форматирования
    let element;
    switch (formatType) {
      case 'bold':
        element = document.createElement('strong');
        break;
      case 'italic':
        element = document.createElement('em');
        break;
      case 'code':
        element = document.createElement('code');
        break;
      case 'strikethrough':
        element = document.createElement('del');
        break;
      case 'underline':
        element = document.createElement('u');
        break;
      default:
        return;
    }

    // проверяем не находится ли выделение уже в таком элементе
    const parentElement = selection.anchorNode.parentElement;
    if (parentElement && parentElement.tagName.toLowerCase() === element.tagName.toLowerCase()) {
      // убираем форматирование
      const parent = parentElement.parentNode;
      while (parentElement.firstChild) {
        parent.insertBefore(parentElement.firstChild, parentElement);
      }
      parent.removeChild(parentElement);
    } else {
      // применяем форматирование, сохраняя пробелы
      try {
        element.textContent = selectedText;
        range.deleteContents();
        range.insertNode(element);
      } catch (e) {
        // если не можем обернуть
        element.textContent = selectedText;
        range.deleteContents();
        range.insertNode(element);
      }
    }

    // обновляем значение
    const telegramHtml = convertHtmlToMarkdown(textareaRef.current.innerHTML);
    onChange(telegramHtml, attachments);

    // очищаем выделение
    selection.removeAllRanges();
  };

  // определяем тип файла для группировки
  const getFileTypeCategory = (file) => {
    if (file.type === 'image/gif') {
      return 'gif';
    } else if (file.type.startsWith('video/')) {
      return 'video';
    } else if (file.type.startsWith('image/')) {
      return 'image';
    }
    return null;
  };

  // обработка файлов
  const handleFiles = async (files) => {
    const fileArray = Array.from(files);
    const mediaFiles = fileArray.filter(file => 
      file.type.startsWith('image/') || 
      file.type === 'image/gif' || 
      file.type === 'video/mp4' ||
      file.type === 'video/quicktime' ||
      file.type === 'video/webm'
    );

    // проверяем есть ли GIF среди существующих или новых файлов
    const hasExistingGif = attachments.some(att => att.displayType === 'gif');
    const hasNewGif = mediaFiles.some(file => getFileTypeCategory(file) === 'gif');

    // правило 1: GIF может быть только один и только сам по себе
    if (hasExistingGif || hasNewGif) {
      if (hasExistingGif && mediaFiles.length > 0) {
        toast.warning('GIF можно добавить только один. Удалите текущий GIF чтобы добавить другие файлы.');
        return;
      }
      if (hasNewGif && (attachments.length > 0 || mediaFiles.length > 1)) {
        toast.warning('GIF можно добавить только один и без других файлов.');
        return;
      }
    }

    // правило 2: фото и видео можно смешивать, но не более 10 всего
    if (!hasNewGif && !hasExistingGif) {
      if (attachments.length + mediaFiles.length > MAX_ATTACHMENTS) {
        toast.error(`Максимум ${MAX_ATTACHMENTS} файлов (фото + видео). Текущих: ${attachments.length}`);
        return;
      }
    }

    const newAttachments = [];
    
    for (const file of mediaFiles) {
      const maxSize = file.type.startsWith('video/') ? 50 * 1024 * 1024 : 10 * 1024 * 1024; // 50MB для видео, 10MB для изображений
      if (file.size > maxSize) {
        const sizeLimit = file.type.startsWith('video/') ? '50MB' : '10MB';
        toast.error(`Файл ${file.name} слишком большой (максимум ${sizeLimit})`);
        continue;
      }

      const reader = new FileReader();
      const filePromise = new Promise((resolve) => {
        reader.onload = (event) => {
          let type = 'photo';
          let displayType = 'photo';
          
          if (file.type === 'image/gif') {
            type = 'gif';
            displayType = 'gif';
          } else if (file.type.startsWith('video/')) {
            // отправляем видео как gif для совместимости с API
            type = 'gif';
            displayType = 'video';
          }
          
          const attachment = {
            type: type, // тип для API
            displayType: displayType, // тип для отображения в UI
            file: file,
            preview: event.target.result,
            name: file.name,
            size: file.size
          };
          resolve(attachment);
        };
      });
      
      reader.readAsDataURL(file);
      newAttachments.push(await filePromise);
    }

    const updatedAttachments = [...attachments, ...newAttachments];
    setAttachments(updatedAttachments);
    onChange(value, updatedAttachments);
  };

  // обработка вставки из буфера обмена
  const handlePaste = async (e) => {
    if (hideAttachments) return; // Не обрабатываем файлы если вложения отключены
    
    const clipboardItems = e.clipboardData.items;
    const files = [];
    
    for (let i = 0; i < clipboardItems.length; i++) {
      const item = clipboardItems[i];
      if (item.type.indexOf('image') !== -1 || item.type.indexOf('video') !== -1) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }

    if (files.length > 0) {
      await handleFiles(files);
    }
  };

  // обработчики Drag & Drop
  const handleDragOver = (e) => {
    e.preventDefault();
    if (!hideAttachments) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (hideAttachments) return; // Не обрабатываем файлы если вложения отключены
    
    const files = Array.from(e.dataTransfer.files);
    await handleFiles(files);
  };

  // удаление вложения
  const removeAttachment = (index) => {
    const newAttachments = attachments.filter((_, i) => i !== index);
    setAttachments(newAttachments);
    onChange(value, newAttachments);
  };

  // добавление ссылки
  const addLink = () => {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    const selectedText = range.toString();
    
    const url = prompt('Введите URL:');
    if (!url) return;

    const linkElement = document.createElement('a');
    linkElement.href = url;
    linkElement.target = '_blank';
    linkElement.rel = 'noopener';
    linkElement.textContent = selectedText || url;

    if (selectedText) {
      range.surroundContents(linkElement);
    } else {
      range.insertNode(linkElement);
    }

    // обновляем значение
    const telegramHtml = convertHtmlToMarkdown(textareaRef.current.innerHTML);
    onChange(telegramHtml, attachments);

    // очищаем выделение
    selection.removeAllRanges();
  };

  // обработка горячих клавиш
  const handleKeyDown = (e) => {
    if (e.ctrlKey || e.metaKey) {
      switch (e.key.toLowerCase()) {
        case 'b':
          e.preventDefault();
          applyFormatting('bold');
          break;
        case 'i':
          e.preventDefault();
          applyFormatting('italic');
          break;
        case 'u':
          e.preventDefault();
          applyFormatting('underline');
          break;
        case 'k':
          e.preventDefault();
          addLink();
          break;
        default:
          break;
      }
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      document.execCommand('insertLineBreak');
      const telegramHtml = convertHtmlToMarkdown(textareaRef.current.innerHTML);
      onChange(telegramHtml, attachments);
      return;
    }
  };

  // преобразуем HTML в Telegram HTML разметку для отправки
  const convertHtmlToMarkdown = (html) => {
    // создаем временный div для парсинга HTML
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    
    // функция для рекурсивной обработки узлов
    const processNode = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent;
      }
      
      if (node.nodeType === Node.ELEMENT_NODE) {
        const tagName = node.tagName.toLowerCase();
        const content = Array.from(node.childNodes).map(processNode).join('');
        
        // Сохраняем содержимое как есть
        const cleanContent = content;
        
        // Преобразуем в Telegram HTML теги
        switch (tagName) {
          case 'strong':
          case 'b':
            return cleanContent ? `<b>${cleanContent}</b>` : '';
          case 'em':
          case 'i':
            return cleanContent ? `<i>${cleanContent}</i>` : '';
          case 'code':
            return cleanContent ? `<code>${cleanContent}</code>` : '';
          case 'del':
          case 's':
            return cleanContent ? `<s>${cleanContent}</s>` : '';
          case 'u':
            return cleanContent ? `<u>${cleanContent}</u>` : '';
          case 'a':
            const href = node.getAttribute('href');
            return cleanContent && href ? `<a href="${href}">${cleanContent}</a>` : cleanContent;
          case 'br':
            return '\n';
          case 'div':
          case 'p':
            return content + (node.nextSibling ? '\n' : '');
          default:
            return content;
        }
      }
      
      return '';
    };
    
    const result = Array.from(tempDiv.childNodes).map(processNode).join('');
    
    // минимальная очистка, убираем только лишние переносы строк
    return result
     // .replace(/\n\s*\n/g, '\n')     // убираем лишние переносы строк
      //.trim();
  };

  // панель инструментов форматирования
  const FormattingToolbar = () => (
    <div className="flex items-center justify-between p-4 bg-gradient-to-r from-blue-50/60 via-indigo-50/40 to-purple-50/60 dark:from-blue-950/30 dark:via-indigo-950/20 dark:to-purple-950/30 backdrop-blur-sm border-b border-gray-200/50 dark:border-gray-600/50">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1 bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm rounded-xl shadow-md p-1 border border-gray-200/30 dark:border-gray-600/30">
          <button
            type="button"
            onClick={() => applyFormatting('bold')}
            disabled={disabled}
            className="p-2 rounded-lg hover:bg-gradient-to-r hover:from-blue-500/20 hover:to-indigo-500/20 dark:hover:from-blue-600/30 dark:hover:to-indigo-600/30 transition-all duration-200 hover:shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            title="Жирный (Ctrl+B)"
          >
            <strong className="text-gray-700 dark:text-gray-300">B</strong>
          </button>
          
          <button
            type="button"
            onClick={() => applyFormatting('italic')}
            disabled={disabled}
            className="p-2 rounded-lg hover:bg-gradient-to-r hover:from-blue-500/20 hover:to-indigo-500/20 dark:hover:from-blue-600/30 dark:hover:to-indigo-600/30 transition-all duration-200 hover:shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            title="Курсив (Ctrl+I)"
          >
            <em className="text-gray-700 dark:text-gray-300">I</em>
          </button>
          
          <button
            type="button"
            onClick={() => applyFormatting('code')}
            disabled={disabled}
            className="p-2 rounded-lg hover:bg-gradient-to-r hover:from-blue-500/20 hover:to-indigo-500/20 dark:hover:from-blue-600/30 dark:hover:to-indigo-600/30 transition-all duration-200 hover:shadow-sm font-mono disabled:opacity-50 disabled:cursor-not-allowed"
            title="Код"
          >
            <span className="text-gray-700 dark:text-gray-300">&lt;/&gt;</span>
          </button>
          
          <button
            type="button"
            onClick={() => applyFormatting('strikethrough')}
            disabled={disabled}
            className="p-2 rounded-lg hover:bg-gradient-to-r hover:from-blue-500/20 hover:to-indigo-500/20 dark:hover:from-blue-600/30 dark:hover:to-indigo-600/30 transition-all duration-200 hover:shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            title="Зачеркнутый"
          >
            <span className="text-gray-700 dark:text-gray-300" style={{ textDecoration: 'line-through' }}>S</span>
          </button>
          
          <button
            type="button"
            onClick={() => applyFormatting('underline')}
            disabled={disabled}
            className="p-2 rounded-lg hover:bg-gradient-to-r hover:from-blue-500/20 hover:to-indigo-500/20 dark:hover:from-blue-600/30 dark:hover:to-indigo-600/30 transition-all duration-200 hover:shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            title="Подчеркнутый"
          >
            <span className="text-gray-700 dark:text-gray-300" style={{ textDecoration: 'underline' }}>U</span>
          </button>
          
          {/* <button
            type="button"
            onClick={addLink}
            disabled={disabled}
            className="p-2 rounded-lg hover:bg-gradient-to-r hover:from-blue-500/20 hover:to-indigo-500/20 dark:hover:from-blue-600/30 dark:hover:to-indigo-600/30 transition-all duration-200 hover:shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            title="Ссылка"
          >
            <span className="text-gray-700 dark:text-gray-300">🔗</span>
          </button> */}
        </div>

        <button
          type="button"
          onClick={() => setShowEmojiPicker(!showEmojiPicker)}
          disabled={disabled}
          className="px-4 py-2.5 bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm rounded-xl shadow-md hover:shadow-lg transition-all duration-200 border border-gray-200/30 dark:border-gray-600/30 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 text-xl leading-none"
          title="Эмоджи"
        >
          😊
        </button>

        {!hideAttachments && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || 
              (attachments.length > 0 && attachments[0].displayType === 'gif' && attachments.length >= MAX_GIF_ATTACHMENTS) ||
              (attachments.length > 0 && attachments[0].displayType !== 'gif' && attachments.length >= MAX_ATTACHMENTS)
            }
            className="px-4 py-2.5 bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm rounded-xl shadow-md hover:shadow-lg transition-all duration-200 border border-gray-200/30 dark:border-gray-600/30 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
            title={
              disabled ? 'Отключено' :
              attachments.length > 0 && attachments[0].displayType === 'gif'
                ? attachments.length >= MAX_GIF_ATTACHMENTS 
                  ? `Максимум ${MAX_GIF_ATTACHMENTS} GIF` 
                  : `Добавить GIF (${attachments.length}/${MAX_GIF_ATTACHMENTS})`
                : attachments.length >= MAX_ATTACHMENTS 
                  ? `Максимум ${MAX_ATTACHMENTS} файлов` 
                  : attachments.length > 0 
                    ? `Добавить ${attachments[0].displayType === 'video' ? 'видео' : 'изображение'} (${attachments.length}/${MAX_ATTACHMENTS})`
                    : `Добавить медиа (0/${MAX_ATTACHMENTS})`
            }
          >
            <Upload className="w-5 h-5 text-gray-700 dark:text-gray-300" />
          </button>
        )}
      </div>

      <div className="text-sm text-gray-500 dark:text-gray-400 bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm px-4 py-2 rounded-xl shadow-md border border-gray-200/30 dark:border-gray-600/30 font-medium">
        {value.length}/{maxLength}
      </div>
    </div>
  );

  return (
    <div className="relative">
      {/* пикер эмодзи через портал */}
      {showEmojiPicker && createPortal(
        <div 
          ref={emojiPickerRef} 
          className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/20 backdrop-blur-sm"
          onClick={(e) => {
            // закрываем только если клик по backdrop
            if (e.target === e.currentTarget) {
              setShowEmojiPicker(false);
            }
          }}
        >
          {/* само окно эмодзи */}
          <div 
            className="relative bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-600 overflow-hidden max-w-sm w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* кнопка закрытия */}
            <button
              onClick={() => setShowEmojiPicker(false)}
              className="absolute top-2 right-2 w-8 h-8 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-full flex items-center justify-center text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors z-10"
            >
              ×
            </button>
            
            <EmojiPicker
              onEmojiClick={onEmojiClick}
              theme={document.documentElement.classList.contains('dark') ? 'dark' : 'light'}
              searchPlaceholder="Поиск эмодзи..."
              previewConfig={{
                showPreview: false
              }}
              width="100%"
              height={400}
              lazyLoadEmojis={true}
            />
          </div>
        </div>,
        document.body
      )}

      {disabled && (
        <div className="absolute inset-0 bg-gray-900/5 dark:bg-gray-100/5 z-10 rounded-2xl pointer-events-none flex items-center justify-center">
          <div className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm px-4 py-2 rounded-lg shadow-lg border border-gray-200 dark:border-gray-600">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{disabledText}</span>
          </div>
        </div>
      )}
      <div className="border border-gray-200/50 dark:border-gray-600/50 rounded-2xl overflow-hidden shadow-xl bg-white/80 dark:bg-gray-800/80 backdrop-blur-xl">
        <FormattingToolbar />
        
        <div 
          className={`relative transition-all duration-300 ${isDragging ? 'bg-gradient-to-br from-blue-50/60 via-indigo-50/40 to-purple-50/60 dark:from-blue-950/30 dark:via-indigo-950/20 dark:to-purple-950/30' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          style={{
            pointerEvents: showEmojiPicker ? 'none' : 'auto'
          }}
        >
          {/* единое поле ввода с визуальным форматированием */}
          <div className="relative">
            <div
              ref={textareaRef}
              contentEditable={!showEmojiPicker && !disabled}
              suppressContentEditableWarning={true}
              onInput={(e) => {
                const htmlContent = e.target.innerHTML;
                const telegramHtml = convertHtmlToMarkdown(htmlContent);
                console.log('TelegramTextEditor: HTML =>', htmlContent);
                console.log('TelegramTextEditor: Telegram HTML =>', telegramHtml);
                onChange(telegramHtml, attachments);
              }}
              onPaste={handlePaste}
              onKeyDown={handleKeyDown}
              className={`w-full min-h-[300px] px-6 py-5 resize-none border-0 focus:ring-0 focus:outline-none
                bg-transparent text-gray-900 dark:text-gray-100 text-base leading-relaxed overflow-y-auto placeholder:text-gray-400 dark:placeholder:text-gray-500 ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
              style={{ 
                wordWrap: 'break-word',
                whiteSpace: 'pre-wrap',
                pointerEvents: (showEmojiPicker || disabled) ? 'none' : 'auto'
              }}
              data-placeholder={placeholder}
            />
            
            {/* placeholder когда поле пустое */}
            {!value && (
              <div className="absolute top-5 left-6 text-gray-400 dark:text-gray-500 pointer-events-none text-base font-medium">
                {placeholder}
              </div>
            )}
            
            {isDragging && (
              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-blue-50/90 via-indigo-50/80 to-purple-50/90 dark:from-blue-950/50 dark:via-indigo-950/40 dark:to-purple-950/50 backdrop-blur-sm border-2 border-dashed border-blue-400/60 dark:border-blue-500/60 rounded-xl">
                <div className="text-center">
                  <div className="text-5xl mb-3">🎬</div>
                  <div className="text-blue-600 dark:text-blue-400 font-semibold text-lg">
                    Отпустите для добавления медиа файлов
                  </div>
                  <div className="text-gray-500 dark:text-gray-400 text-sm mt-1">
                    {attachments.length > 0 
                      ? `Можно добавлять только ${
                          attachments[0].displayType === 'gif' ? 'GIF' : 
                          attachments[0].displayType === 'video' ? 'видео' : 
                          'изображения'
                        }`
                      : 'Поддерживаются изображения, GIF и видео'
                    }
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* предпросмотр вложений */}
          {attachments.length > 0 && (
            <div className="p-6 border-t border-gray-200/50 dark:border-gray-600/50 bg-gradient-to-br from-gray-50/60 via-blue-50/30 to-indigo-50/60 dark:from-gray-900/60 dark:via-blue-950/30 dark:to-indigo-950/60 backdrop-blur-sm">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                    Прикрепленные файлы ({attachments.length}/{attachments[0].displayType === 'gif' ? MAX_GIF_ATTACHMENTS : MAX_ATTACHMENTS})
                  </div>
                  <div className="text-xs text-blue-600 dark:text-blue-400 mt-1 font-medium">
                    💡 {
                      attachments[0].displayType === 'gif' 
                        ? 'GIF отправляется отдельно' 
                        : 'Фото и видео можно комбинировать (до 10 шт.)'
                    }
                  </div>
                </div>
                {((attachments[0].displayType === 'gif' && attachments.length >= MAX_GIF_ATTACHMENTS) ||
                  (attachments[0].displayType !== 'gif' && attachments.length >= MAX_ATTACHMENTS)) && (
                  <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded-lg font-medium">
                    Достигнут лимит файлов
                  </div>
                )}
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
                {attachments.map((attachment, index) => (
                  <div key={index} className="relative group">
                    <div className="aspect-square rounded-xl overflow-hidden border-2 border-gray-300/60 dark:border-gray-600/60 shadow-lg hover:shadow-2xl transition-all duration-300 bg-white dark:bg-gray-800 hover:scale-105">
                      {(attachment.displayType === 'video' || attachment.displayType === 'gif') ? (
                        <video
                          src={attachment.preview}
                          className="w-full h-full object-cover"
                          muted
                          loop
                          playsInline
                          autoPlay={attachment.displayType === 'gif'}
                          onMouseEnter={(e) => e.target.play()}
                          onMouseLeave={(e) => {
                            if (attachment.displayType !== 'gif') e.target.pause();
                          }}
                        />
                      ) : (
                        <img
                          src={attachment.preview}
                          alt={attachment.name}
                          className="w-full h-full object-cover"
                        />
                      )}
                      
                      {/* бейдж типа файла */}
                      {attachment.displayType === 'gif' && (
                        <div className="absolute top-2 left-2 bg-gradient-to-r from-purple-500 to-purple-600 text-white text-[10px] px-2 py-1 rounded-md font-bold shadow-lg">
                          GIF
                        </div>
                      )}
                      {attachment.displayType === 'video' && (
                        <div className="absolute top-2 left-2 bg-gradient-to-r from-red-500 to-red-600 text-white text-[10px] px-2 py-1 rounded-md font-bold shadow-lg">
                          VIDEO
                        </div>
                      )}
                      {attachment.displayType === 'photo' && (
                        <div className="absolute top-2 left-2 bg-gradient-to-r from-green-500 to-green-600 text-white text-[10px] px-2 py-1 rounded-md font-bold shadow-lg">
                          PHOTO
                        </div>
                      )}
                      
                      {/* размер файла внизу */}
                      <div className="absolute bottom-2 left-2 right-2 text-center">
                        <div className="bg-black/70 backdrop-blur-sm text-white text-[10px] px-2 py-0.5 rounded-md font-semibold inline-block">
                          {(attachment.size / 1024 / 1024).toFixed(1)} MB
                        </div>
                      </div>
                    </div>
                    
                    {/* кнопка удаления */}
                    <button
                      type="button"
                      onClick={() => removeAttachment(index)}
                      className="absolute -top-2 -right-2 w-8 h-8 bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white rounded-full text-lg font-bold
                        opacity-90 group-hover:opacity-100 transition-all duration-200 flex items-center justify-center shadow-xl hover:shadow-2xl hover:scale-110 z-10"
                      title="Удалить файл"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* скрытый input для выбора файлов */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,.gif,video/mp4,video/quicktime,video/webm"
        onChange={(e) => handleFiles(e.target.files)}
        className="hidden"
      />

      {/* подсказки */}
      <div className="mt-4 space-y-3">
        <div className="text-sm text-gray-500 dark:text-gray-400">
          <details>
            <summary className="cursor-pointer hover:text-gray-700 dark:hover:text-gray-300 font-medium">
              💡 Горячие клавиши и форматирование
            </summary>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="space-y-1">
                <div><kbd className="bg-gray-100 dark:bg-gray-700 px-1 rounded">Ctrl+B</kbd> → <strong>жирный</strong></div>
                <div><kbd className="bg-gray-100 dark:bg-gray-700 px-1 rounded">Ctrl+I</kbd> → <em>курсив</em></div>
                <div><kbd className="bg-gray-100 dark:bg-gray-700 px-1 rounded">Ctrl+U</kbd> → <u>подчеркнутый</u></div>
              </div>
              <div className="space-y-1">
                <div><kbd className="bg-gray-100 dark:bg-gray-700 px-1 rounded">Ctrl+K</kbd> → ссылка</div>
                {!hideAttachments && (
                  <>
                    <div><kbd className="bg-gray-100 dark:bg-gray-700 px-1 rounded">Ctrl+V</kbd> → вставить медиа</div>
                    <div>Drag & Drop → перетащить файлы</div>
                  </>
                )}
              </div>
            </div>
          </details>
        </div>
        {!hideAttachments && (
          <div className="bg-blue-50/60 dark:bg-blue-900/20 border border-blue-200/50 dark:border-blue-700/50 rounded-xl p-3">
            <div className="flex items-start gap-2">
              <div className="text-blue-600 dark:text-blue-400 text-lg"><MessageCircleWarning/></div>
              <div className="text-xs text-blue-700 dark:text-blue-300">
                <strong>Правила вложений:</strong> <strong>GIF</strong> — только 1 и отдельно. <strong>Фото + видео</strong> — можно комбинировать вместе до 10 штук.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TelegramTextEditor;