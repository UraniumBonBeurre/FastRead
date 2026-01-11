export interface BookStructure {
  words: string[];
  chapters: { title: string; index: number }[];
}

export const processBookText = (text: string): BookStructure => {
  // 1. Normalize line endings
  let cleanText = text.replace(/\r\n/g, '\n');

  // 2. Attempt to remove Project Gutenberg Header
  // Pattern: *** START OF THIS PROJECT GUTENBERG EBOOK ... ***
  const startMarker = /\*\*\* ?START OF (THIS|THE) PROJECT GUTENBERG EBOOK.*?\*\*\*/i;
  const matchStart = cleanText.match(startMarker);
  
  if (matchStart && matchStart.index !== undefined) {
    cleanText = cleanText.slice(matchStart.index + matchStart[0].length);
  }

  // 3. Attempt to remove Project Gutenberg Footer
  const endMarker = /\*\*\* ?END OF (THIS|THE) PROJECT GUTENBERG EBOOK.*?\*\*\*/i;
  const matchEnd = cleanText.match(endMarker);
  if (matchEnd && matchEnd.index !== undefined) {
    cleanText = cleanText.slice(0, matchEnd.index);
  }

  // 4. Try to find the "real" start of content to skip glossary/metadata
  // Heuristic: Look for "Chapter 1", "Chapter I", or the first big block of text.
  // This is aggressive but requested.
  // We'll look for the first occurrence of "Chapter" followed by a number or Roman numeral associated with a newline.
  const chapterStartPattern = /(?:^|\n)\s*(?:CHAPTER|CHAPITRE)\s+(?:I+ |\d+)/i;
  const firstChapterMatch = cleanText.match(chapterStartPattern);
  
  // If we find a clear "Chapter 1", we might want to trim everything before it?
  // Be careful: The user might lose the Title Page or Introduction. 
  // User said: "Skip glossary ... user needs body of text". 
  // We'll rely on the Chapter extraction below to navigate, but let's try to trim PREAMBLE junk if clearly identified.
  
  // Let's NOT hard trim text based on Chapter 1 because Intro might be important.
  // Instead we will identifying Chapters and let the UI prompt/start at Chapter 1.

  // 5. Structure Cleaning & Chapter Detection
  // We want to map word indices to chapters.
  // We need to preserve the original text momentarily to find chapter indices in the WORD array.
  
  const chapters: { title: string; index: number }[] = [];
  
  // Tokenize by splitting, but we need to track where chapters are.
  // A simple strategy: Split by chapter headers first? No, that breaks word flow.
  
  // We will iterate through the text, find chapter headers, and correlate with word count.
  // Implementation: Regex.exec loop
  
  const chapterRegex = /(?:^|\n)((?:CHAPTER|CHAPITRE|PARTie)\s+(?:[IVXLCDM]+|\d+).*?)(?:\n|$)/gi;
  // This regex captures lines looking like "CHAPTER 1: The Beginning"
  
  let match;
  // We'll need to know the *word index* corresponding to the character index.
  // This is expensive to calculate exactly if we just split all at once.
  
  // Alternative: Tokenize first, then look for patterns in the words?
  // "Chapter", "1" -> Chapter detected.
  
  const words = cleanText
    .split(/\s+/)
    .filter(w => w.length > 0);

  // Scan words for "Chapter" keywords to build the chapter list
  // limit heuristic: "Chapter" must be followed by a number/roman.
  
  for (let i = 0; i < words.length - 1; i++) {
    const w = words[i].toUpperCase();
    if (w === 'CHAPTER' || w === 'CHAPITRE') {
      const next = words[i+1].toUpperCase();
      // Check if next is number or roman
      if (/^(\d+|[IVXLCDM]+)[\.:]?$/.test(next)) {
        // Found one
        // Let's assume the title is these two words + maybe next few?
        // Simplicity: just "Chapter X"
        chapters.push({
          title: `${words[i]} ${words[i+1]}`,
          index: i
        });
        i++; // skip next
      }
    }
  }
  
  // If no chapters found, maybe default to "Start"
  if (chapters.length === 0) {
      chapters.push({ title: 'Début', index: 0 });
  }

  return { words, chapters };
};
