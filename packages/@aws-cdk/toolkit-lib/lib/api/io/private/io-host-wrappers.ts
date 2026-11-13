import type { IoMessage, IoRequest, IIoHost } from '../';

/**
 * An IoHost wrapper that strips out ANSI colors and styles from the message before
 * sending the message to the given IoHost
 */
export function withoutColor(ioHost: IIoHost): IIoHost {
  return {
    notify: async <T>(msg: IoMessage<T>) => {
      await ioHost.notify({
        ...msg,
        message: stripColor(msg.message),
      });
    },
    requestResponse: async <T, U>(msg: IoRequest<T, U>) => {
      return ioHost.requestResponse({
        ...msg,
        message: stripColor(msg.message),
      });
    },
  };
}

function stripColor(msg: string): string {
  return msg.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

/**
 * An IoHost wrapper that strips out emojis from the message before
 * sending the message to the given IoHost
 */
export function withoutEmojis(ioHost: IIoHost): IIoHost {
  return {
    notify: async <T>(msg: IoMessage<T>) => {
      await ioHost.notify({
        ...msg,
        message: stripEmojis(msg.message),
      });
    },
    requestResponse: async <T, U>(msg: IoRequest<T, U>) => {
      return ioHost.requestResponse({
        ...msg,
        message: stripEmojis(msg.message),
      });
    },
  };
}

function stripEmojis(msg: string): string {
  // https://www.unicode.org/reports/tr51/#def_emoji_presentation
  return msg.replace(/\p{Emoji_Presentation}/gu, '');
}

/**
 * An IoHost wrapper that trims whitespace at the beginning and end of messages.
 * This is required, since after removing emojis and ANSI colors,
 * we might end up with floating whitespace at either end.
 */
export function withTrimmedWhitespace(ioHost: IIoHost): IIoHost {
  return {
    notify: async <T>(msg: IoMessage<T>) => {
      await ioHost.notify({
        ...msg,
        message: trimWhitespace(msg.message),
      });
    },
    requestResponse: async <T, U>(msg: IoRequest<T, U>) => {
      return ioHost.requestResponse({
        ...msg,
        message: trimWhitespace(msg.message),
      });
    },
  };
}

/**
 * Trims whitespace at both ends of a message, also when it sits inside
 * ANSI style codes (e.g. a colored message that starts with a newline).
 * The style codes themselves are kept.
 */
function trimWhitespace(msg: string): string {
  // Even indices are text, odd indices are the style codes between them
  const parts = msg.split(/(\u001b\[[0-9;]*m)/);
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = parts[i].trimStart();
    if (parts[i]) {
      break;
    }
  }
  for (let i = parts.length - 1; i >= 0; i -= 2) {
    parts[i] = parts[i].trimEnd();
    if (parts[i]) {
      break;
    }
  }
  return parts.join('');
}
