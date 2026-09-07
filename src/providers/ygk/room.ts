import { normalizeText } from '../../parser/text.ts';

/**
 * Нормализует краткую запись кабинета, не добавляя неуказанный корпус.
 *
 * «к 25» и «к.21» остаются кабинетами без корпуса. Это важно для календаря:
 * время нельзя выводить из корпуса, которого нет в исходной таблице.
 */
export const normalizeYgkRoom = (value: string): string => {
  const normalized = normalizeText(value);
  if (normalized.includes('\n')) return normalized;
  const bareRoom = /^(?:к|каб(?:инет)?)\.?\s*(?:№\s*)?(\d{1,4})$/iu.exec(
    normalized,
  );
  return bareRoom?.[1] ? `к.${bareRoom[1]}` : normalized;
};
