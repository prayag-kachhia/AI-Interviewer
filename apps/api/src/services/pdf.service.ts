import fs from 'fs';
import { PDFParse } from 'pdf-parse';

/**
 * Extracts text from a PDF file buffer
 */
export const extractTextFromPdfBuffer = async (buffer: Buffer): Promise<string> => {
  let parser;
  try {
    parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    return cleanExtractedText(result.text);
  } catch (error) {
    console.error('PDF parsing error:', error);
    throw new Error('Failed to extract text from PDF');
  } finally {
    if (parser) {
      await parser.destroy();
    }
  }
};

/**
 * Extracts text from a PDF file by path
 */
export const extractTextFromPdfFile = async (filePath: string): Promise<string> => {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    return await extractTextFromPdfBuffer(dataBuffer);
  } catch (error) {
    console.error('PDF read error:', error);
    throw new Error('Failed to read PDF file');
  }
};

/**
 * Cleans extracted text by removing excessive whitespace and normalizing newlines
 */
const cleanExtractedText = (text: string): string => {
  if (!text) return '';

  return text
    .replace(/\r\n/g, '\n') // Normalize newlines
    .replace(/--\s*\d+\s*of\s*\d+\s*--/gi, '') // Remove page counter artifacts
    .replace(/\n{3,}/g, '\n\n') // Reduce multiple newlines to max 2
    .replace(/[ \t]+/g, ' ') // Reduce multiple spaces/tabs to a single space
    .trim();
};
