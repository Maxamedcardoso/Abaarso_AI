import { GoogleGenerativeAI } from '@google/generative-ai';

async function testDuckDuckGoHtml(query: string) {
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    const html = await res.text();
    const matches = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)];
    const snippets = matches.map(m => m[1].replace(/<[^>]+>/g, '').trim()).filter(Boolean).slice(0, 4);
    console.log('Clean Live Web Snippets:', snippets);
  } catch (err: any) {
    console.log('Error:', err.message);
  }
}

testDuckDuckGoHtml('Real Madrid vs Borussia Dortmund Champions League 2024 final score');



