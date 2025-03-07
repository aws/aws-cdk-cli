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
        message: msg.message.trim(),
      });
    },
    requestResponse: async <T, U>(msg: IoRequest<T, U>) => {
      return ioHost.requestResponse({
        ...msg,
        message: msg.message.trim(),
      });
    },
  };
}
