const Anthropic = require('@anthropic-ai/sdk');
const PptxGenJS = require('pptxgenjs');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const themes = {
  midnight: { background: '0B1426', text: 'F8F4E8', accent: 'D4A853', fontFace: 'Georgia', bodyFont: 'Trebuchet MS' },
  ocean: { background: '0C1929', text: 'E8F4F8', accent: '2B788B', fontFace: 'Arial', bodyFont: 'Arial' },
  forest: { background: '1A2E1A', text: 'F0F7F0', accent: '4A7C59', fontFace: 'Georgia', bodyFont: 'Verdana' },
  coral: { background: '2D1B1B', text: 'FFF5F0', accent: 'E07A5F', fontFace: 'Georgia', bodyFont: 'Arial' },
  minimal: { background: 'FFFFFF', text: '1A1A1A', accent: '6366F1', fontFace: 'Arial', bodyFont: 'Arial' },
  dark: { background: '18181B', text: 'FAFAFA', accent: 'A855F7', fontFace: 'Arial', bodyFont: 'Arial' }
};

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

module.exports = async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.status(200).set(corsHeaders).end();
    return;
  }

  // Set CORS headers for all responses
  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.setHeader(key, value);
  });

  const path = req.url.split('?')[0];

  try {
    // Health check
    if (path === '/api/health') {
      return res.json({ status: 'ok', time: new Date().toISOString() });
    }

    // Generate outline
    if (path === '/api/generate-outline' && req.method === 'POST') {
      const { content, slideCount, presentationType } = req.body;

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: `You are an expert presentation designer for students. Create an outline for a ${presentationType} presentation with exactly ${slideCount} slides.

RESPOND WITH ONLY VALID JSON (no markdown, no backticks):
{
  "title": "Presentation Title",
  "outline": [
    {
      "id": 1,
      "slideType": "title",
      "title": "Slide Title",
      "description": "What this slide covers",
      "keyPoints": ["point 1", "point 2", "point 3"]
    }
  ]
}

Slide types: title, content, twoColumn, quote, stats, conclusion

Content to create presentation about:
${content}`
        }]
      });

      const text = response.content[0].text;
      const json = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}');
      return res.json(json);
    }

    // Generate slide content
    if (path === '/api/generate-slide' && req.method === 'POST') {
      const { slideOutline, originalContent } = req.body;

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `Create content for this slide:
Title: ${slideOutline.title}
Type: ${slideOutline.slideType}
Description: ${slideOutline.description}
Key Points: ${slideOutline.keyPoints?.join(', ')}
Context: ${originalContent?.slice(0, 500)}

Return ONLY JSON (no markdown):
{
  "title": "Slide Title",
  "subtitle": "Optional subtitle",
  "content": ["Bullet 1", "Bullet 2", "Bullet 3"],
  "statValue": "73%",
  "statLabel": "key metric",
  "quote": "Quote if applicable",
  "quoteAuthor": "Author"
}`
        }]
      });

      const text = response.content[0].text;
      const json = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}');
      return res.json(json);
    }

    // Generate PowerPoint
    if (path === '/api/generate-pptx' && req.method === 'POST') {
      const { slides, theme: themeId, title } = req.body;
      const theme = themes[themeId] || themes.midnight;

      const pptx = new PptxGenJS();
      pptx.layout = 'LAYOUT_16x9';
      pptx.title = title || 'Presentation';

      for (const slideData of slides) {
        const slide = pptx.addSlide();
        slide.background = { color: theme.background };

        // Accent bar
        slide.addShape(pptx.shapes.RECTANGLE, { x: 0, y: 0, w: '100%', h: 0.08, fill: { color: theme.accent } });

        switch (slideData.type) {
          case 'title':
            slide.addText(slideData.title || 'Title', {
              x: 0.5, y: 2, w: 9, h: 1.5,
              fontSize: 44, fontFace: theme.fontFace, color: theme.text, bold: true, align: 'center'
            });
            if (slideData.subtitle) {
              slide.addText(slideData.subtitle, {
                x: 0.5, y: 3.5, w: 9, h: 0.8,
                fontSize: 20, fontFace: theme.bodyFont, color: theme.text, align: 'center'
              });
            }
            break;

          case 'stats':
            slide.addText(slideData.title, { x: 0.5, y: 0.4, w: 9, h: 0.8, fontSize: 32, fontFace: theme.fontFace, color: theme.text, bold: true });
            slide.addText(slideData.statValue || '73%', { x: 0.5, y: 1.8, w: 9, h: 1.5, fontSize: 80, fontFace: theme.fontFace, color: theme.accent, bold: true, align: 'center' });
            slide.addText(slideData.statLabel || '', { x: 0.5, y: 3.3, w: 9, h: 0.6, fontSize: 20, fontFace: theme.bodyFont, color: theme.text, align: 'center' });
            if (slideData.content?.length) {
              const bullets = slideData.content.map(c => ({ text: c, options: { bullet: { color: theme.accent }, fontSize: 16, color: theme.text, paraSpaceAfter: 8 } }));
              slide.addText(bullets, { x: 1.5, y: 4, w: 7, h: 1.3 });
            }
            break;

          case 'quote':
            slide.addText('"', { x: 1, y: 1.2, w: 1, h: 1, fontSize: 100, fontFace: theme.fontFace, color: theme.accent });
            slide.addText(slideData.quote || slideData.content?.[0] || '', {
              x: 1.2, y: 2, w: 7.6, h: 2, fontSize: 26, fontFace: theme.fontFace, color: theme.text, italic: true, align: 'center', valign: 'middle'
            });
            if (slideData.quoteAuthor) {
              slide.addText(`— ${slideData.quoteAuthor}`, { x: 1, y: 4.2, w: 8, h: 0.5, fontSize: 16, fontFace: theme.bodyFont, color: theme.text, align: 'center' });
            }
            break;

          case 'conclusion':
            slide.addText(slideData.title, { x: 0.5, y: 1.5, w: 9, h: 1, fontSize: 40, fontFace: theme.fontFace, color: theme.text, bold: true, align: 'center' });
            if (slideData.content?.length) {
              const bullets = slideData.content.map(c => ({ text: c, options: { fontSize: 18, color: theme.text, align: 'center', paraSpaceAfter: 12 } }));
              slide.addText(bullets, { x: 1.5, y: 2.8, w: 7, h: 1.5 });
            }
            slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, { x: 3.5, y: 4.4, w: 3, h: 0.6, fill: { color: theme.accent } });
            slide.addText('Thank You!', { x: 3.5, y: 4.4, w: 3, h: 0.6, fontSize: 18, fontFace: theme.bodyFont, color: theme.background, bold: true, align: 'center', valign: 'middle' });
            break;

          default: // content, twoColumn
            slide.addText(slideData.title || '', { x: 0.5, y: 0.4, w: 9, h: 0.8, fontSize: 32, fontFace: theme.fontFace, color: theme.text, bold: true });
            if (slideData.content?.length) {
              const bullets = slideData.content.map(c => ({
                text: c,
                options: { bullet: { type: 'bullet', color: theme.accent }, fontSize: 18, fontFace: theme.bodyFont, color: theme.text, paraSpaceAfter: 14 }
              }));
              slide.addText(bullets, { x: 0.7, y: 1.4, w: 8.5, h: 3.8 });
            }
        }

        slide.addText(String(slideData.id), { x: 9.2, y: 5.2, w: 0.5, h: 0.3, fontSize: 10, color: theme.text });
      }

      const buffer = await pptx.write({ outputType: 'nodebuffer' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
      res.setHeader('Content-Disposition', `attachment; filename="${title || 'presentation'}.pptx"`);
      return res.send(buffer);
    }

    // 404 for unknown routes
    res.status(404).json({ error: 'Not found' });

  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};
