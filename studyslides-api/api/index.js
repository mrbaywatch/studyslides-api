const Anthropic = require('@anthropic-ai/sdk');
const PptxGenJS = require('pptxgenjs');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const themes = {
  midnight: { name: 'Midnight', background: '0F172A', text: 'F8FAFC', accent: 'F59E0B', secondary: '1E293B' },
  ocean: { name: 'Ocean', background: '0C4A6E', text: 'F0F9FF', accent: '38BDF8', secondary: '075985' },
  forest: { name: 'Forest', background: '14532D', text: 'F0FDF4', accent: '4ADE80', secondary: '166534' },
  sunset: { name: 'Sunset', background: '7C2D12', text: 'FFF7ED', accent: 'FB923C', secondary: '9A3412' },
  minimal: { name: 'Minimal', background: 'FFFFFF', text: '1E293B', accent: '6366F1', secondary: 'F1F5F9' },
  dark: { name: 'Dark', background: '18181B', text: 'FAFAFA', accent: 'A855F7', secondary: '27272A' }
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
    return res.status(200).set(corsHeaders).end();
  }

  // Set CORS headers
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

      console.log('Generating outline for:', content);

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: `You are an expert presentation designer. Create a detailed, content-rich outline for a ${presentationType} presentation with exactly ${slideCount} slides about: "${content}"

CRITICAL: Generate REAL, SPECIFIC content about the topic. Research and include actual facts, statistics, and insights.

Return ONLY valid JSON (no markdown, no backticks, no explanation):
{
  "title": "Compelling Presentation Title",
  "outline": [
    {
      "id": 1,
      "slideType": "title",
      "title": "Main Title Here",
      "subtitle": "Compelling subtitle",
      "description": "Opening slide"
    },
    {
      "id": 2,
      "slideType": "content",
      "title": "Specific Topic Name",
      "description": "What this slide explains",
      "keyPoints": ["Specific fact 1 with data", "Specific fact 2 with data", "Specific fact 3 with data"]
    }
  ]
}

Slide types to use:
- "title": Opening slide (use for slide 1)
- "content": Main content with 3-4 bullet points
- "stats": Feature a big statistic (include statValue like "73%" and statLabel)
- "twoColumn": Compare two things
- "quote": Expert quote or key insight
- "conclusion": Summary with call-to-action (use for last slide)

IMPORTANT: 
- Every slide must have specific, factual content about "${content}"
- Include real statistics, dates, names, and facts
- Make keyPoints detailed and informative (15-25 words each)
- Vary the slide types for visual interest`
        }]
      });

      const text = response.content[0].text;
      console.log('API Response:', text.substring(0, 500));
      
      // Extract JSON
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      
      const json = JSON.parse(jsonMatch[0]);
      console.log('Parsed outline:', json.title, 'with', json.outline?.length, 'slides');
      
      return res.json(json);
    }

    // Generate slide content
    if (path === '/api/generate-slide' && req.method === 'POST') {
      const { slideOutline, originalContent } = req.body;

      console.log('Generating slide:', slideOutline.title);

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: `Create detailed content for this presentation slide about "${originalContent}":

Slide Title: ${slideOutline.title}
Slide Type: ${slideOutline.slideType}
Description: ${slideOutline.description}
Key Points to expand: ${slideOutline.keyPoints?.join('; ') || 'Generate relevant points'}

Return ONLY valid JSON (no markdown, no backticks):
{
  "title": "${slideOutline.title}",
  "subtitle": "Optional subtitle if relevant",
  "content": [
    "Detailed point 1 with specific facts (15-20 words)",
    "Detailed point 2 with specific facts (15-20 words)", 
    "Detailed point 3 with specific facts (15-20 words)"
  ],
  "statValue": "73%",
  "statLabel": "Description of what this statistic means",
  "quote": "Relevant quote if this is a quote slide",
  "quoteAuthor": "Author Name, Title"
}

IMPORTANT:
- Content must be SPECIFIC to "${originalContent}"
- Include real facts, statistics, examples
- Each bullet point should be 15-20 words
- For stats slides, use real or realistic statistics
- For quote slides, use a real or realistic expert quote`
        }]
      });

      const text = response.content[0].text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      
      const json = JSON.parse(jsonMatch[0]);
      console.log('Generated slide content:', json.title);
      
      return res.json(json);
    }

    // Generate PowerPoint
    if (path === '/api/generate-pptx' && req.method === 'POST') {
      const { slides, theme: themeId, title } = req.body;
      const theme = themes[themeId] || themes.midnight;

      const pptx = new PptxGenJS();
      pptx.layout = 'LAYOUT_16x9';
      pptx.title = title || 'Presentation';
      pptx.author = 'StudySlides';

      for (const slideData of slides) {
        const slide = pptx.addSlide();
        slide.background = { color: theme.background };

        // Top accent bar
        slide.addShape(pptx.shapes.RECTANGLE, { 
          x: 0, y: 0, w: '100%', h: 0.06, 
          fill: { color: theme.accent } 
        });

        // Decorative element
        slide.addShape(pptx.shapes.RECTANGLE, { 
          x: 8.5, y: 0.5, w: 1.5, h: 4.5, 
          fill: { color: theme.secondary },
          transparency: 50
        });

        switch (slideData.type) {
          case 'title':
            slide.addText(slideData.title || 'Title', {
              x: 0.8, y: 1.8, w: 8, h: 1.2,
              fontSize: 40, fontFace: 'Arial', color: theme.text, bold: true
            });
            if (slideData.subtitle) {
              slide.addText(slideData.subtitle, {
                x: 0.8, y: 3.1, w: 8, h: 0.6,
                fontSize: 20, fontFace: 'Arial', color: theme.text, transparency: 40
              });
            }
            // Accent line
            slide.addShape(pptx.shapes.RECTANGLE, { 
              x: 0.8, y: 3.8, w: 2, h: 0.08, 
              fill: { color: theme.accent } 
            });
            break;

          case 'stats':
            slide.addText(slideData.title, { 
              x: 0.8, y: 0.5, w: 8, h: 0.7, 
              fontSize: 28, fontFace: 'Arial', color: theme.text, bold: true 
            });
            slide.addText(slideData.statValue || '73%', { 
              x: 0.8, y: 1.5, w: 8, h: 1.8, 
              fontSize: 100, fontFace: 'Arial', color: theme.accent, bold: true
            });
            slide.addText(slideData.statLabel || '', { 
              x: 0.8, y: 3.3, w: 8, h: 0.5, 
              fontSize: 18, fontFace: 'Arial', color: theme.text, transparency: 30
            });
            if (slideData.content?.length) {
              const bullets = slideData.content.slice(0, 3).map(c => ({
                text: c,
                options: { bullet: { color: theme.accent }, fontSize: 14, color: theme.text, paraSpaceAfter: 8 }
              }));
              slide.addText(bullets, { x: 0.8, y: 4, w: 8, h: 1.2 });
            }
            break;

          case 'quote':
            slide.addText('"', { 
              x: 0.5, y: 1, w: 1, h: 1.2, 
              fontSize: 120, fontFace: 'Georgia', color: theme.accent, transparency: 30
            });
            slide.addText(slideData.quote || slideData.content?.[0] || '', {
              x: 1, y: 1.8, w: 7.5, h: 2,
              fontSize: 24, fontFace: 'Georgia', color: theme.text, italic: true, align: 'center', valign: 'middle'
            });
            if (slideData.quoteAuthor) {
              slide.addText(`— ${slideData.quoteAuthor}`, { 
                x: 1, y: 4, w: 7.5, h: 0.5, 
                fontSize: 14, fontFace: 'Arial', color: theme.accent, align: 'center'
              });
            }
            break;

          case 'conclusion':
            slide.addText(slideData.title, { 
              x: 0.8, y: 1.2, w: 8, h: 0.8, 
              fontSize: 36, fontFace: 'Arial', color: theme.text, bold: true, align: 'center'
            });
            if (slideData.content?.length) {
              const items = slideData.content.map(c => ({
                text: c,
                options: { fontSize: 18, color: theme.text, align: 'center', paraSpaceAfter: 16 }
              }));
              slide.addText(items, { x: 1, y: 2.3, w: 7.5, h: 2 });
            }
            slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, { 
              x: 3.5, y: 4.3, w: 2.5, h: 0.6, 
              fill: { color: theme.accent } 
            });
            slide.addText('Thank You', { 
              x: 3.5, y: 4.3, w: 2.5, h: 0.6, 
              fontSize: 16, fontFace: 'Arial', color: theme.background, bold: true, align: 'center', valign: 'middle'
            });
            break;

          case 'twoColumn':
            slide.addText(slideData.title || '', { 
              x: 0.8, y: 0.5, w: 8, h: 0.7, 
              fontSize: 28, fontFace: 'Arial', color: theme.text, bold: true 
            });
            const content = slideData.content || [];
            const mid = Math.ceil(content.length / 2);
            
            // Left column
            const leftItems = content.slice(0, mid).map(c => ({
              text: c,
              options: { bullet: { color: theme.accent }, fontSize: 16, color: theme.text, paraSpaceAfter: 12 }
            }));
            slide.addText(leftItems, { x: 0.8, y: 1.4, w: 4, h: 3.5 });
            
            // Divider
            slide.addShape(pptx.shapes.RECTANGLE, { 
              x: 4.9, y: 1.4, w: 0.02, h: 3, 
              fill: { color: theme.accent }, transparency: 50
            });
            
            // Right column
            const rightItems = content.slice(mid).map(c => ({
              text: c,
              options: { bullet: { color: theme.accent }, fontSize: 16, color: theme.text, paraSpaceAfter: 12 }
            }));
            slide.addText(rightItems, { x: 5.2, y: 1.4, w: 4, h: 3.5 });
            break;

          default: // content
            slide.addText(slideData.title || '', { 
              x: 0.8, y: 0.5, w: 8, h: 0.7, 
              fontSize: 28, fontFace: 'Arial', color: theme.text, bold: true 
            });
            if (slideData.content?.length) {
              const bullets = slideData.content.map(c => ({
                text: c,
                options: { 
                  bullet: { color: theme.accent }, 
                  fontSize: 18, 
                  fontFace: 'Arial', 
                  color: theme.text, 
                  paraSpaceAfter: 16 
                }
              }));
              slide.addText(bullets, { x: 0.8, y: 1.4, w: 7.5, h: 3.8 });
            }
        }

        // Slide number
        slide.addText(String(slideData.id), { 
          x: 9.2, y: 5.1, w: 0.4, h: 0.3, 
          fontSize: 10, color: theme.text, transparency: 50 
        });
      }

      const buffer = await pptx.write({ outputType: 'nodebuffer' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
      res.setHeader('Content-Disposition', `attachment; filename="${title || 'presentation'}.pptx"`);
      return res.send(buffer);
    }

    res.status(404).json({ error: 'Not found' });

  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};