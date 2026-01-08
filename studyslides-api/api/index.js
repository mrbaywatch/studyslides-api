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

// Fetch image from Unsplash
async function getUnsplashImage(query) {
  try {
    const searchQuery = encodeURIComponent(query.slice(0, 50));
    // Using Unsplash Source for free, no-API-key images
    return `https://source.unsplash.com/800x600/?${searchQuery}`;
  } catch (error) {
    console.error('Image fetch error:', error);
    return null;
  }
}

module.exports = async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const path = req.url.split('?')[0];

  try {
    // Health check
    if (path === '/api/health') {
      return res.status(200).json({ status: 'ok', time: new Date().toISOString() });
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
          content: `You are an expert presentation designer. Create a detailed outline for a ${presentationType} presentation with exactly ${slideCount} slides about: "${content}"

Return ONLY valid JSON (no markdown, no backticks):
{
  "title": "Compelling Presentation Title",
  "outline": [
    {
      "id": 1,
      "slideType": "title",
      "title": "Main Title",
      "subtitle": "Subtitle here",
      "description": "Opening slide",
      "imageKeyword": "keyword for background image"
    },
    {
      "id": 2,
      "slideType": "imageRight",
      "title": "Topic Name",
      "description": "What this covers",
      "keyPoints": ["Point 1", "Point 2", "Point 3"],
      "imageKeyword": "relevant image keyword"
    }
  ]
}

SLIDE TYPES (use variety!):
- "title": Opening slide with big title
- "imageRight": Content left, image right (MOST COMMON - use often!)
- "imageLeft": Image left, content right  
- "imageBackground": Full background image with text overlay
- "stats": Big statistic with supporting points
- "quote": Expert quote
- "twoColumn": Compare two things
- "conclusion": Summary slide

IMPORTANT:
- Use "imageRight" or "imageLeft" for MOST content slides (at least 50%)
- Every slide needs "imageKeyword" - a 1-3 word search term for finding a relevant photo
- Make keyPoints specific and factual (15-25 words each)
- Include real statistics, facts, examples about "${content}"`
        }]
      });

      const text = response.content[0].text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');
      
      const json = JSON.parse(jsonMatch[0]);
      return res.status(200).json(json);
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
Key Points: ${slideOutline.keyPoints?.join('; ') || 'Generate relevant points'}
Image Keyword: ${slideOutline.imageKeyword || ''}

Return ONLY valid JSON:
{
  "title": "${slideOutline.title}",
  "subtitle": "Optional subtitle",
  "content": [
    "Detailed bullet point 1 (15-20 words with specific facts)",
    "Detailed bullet point 2 (15-20 words with specific facts)", 
    "Detailed bullet point 3 (15-20 words with specific facts)"
  ],
  "statValue": "73%",
  "statLabel": "What this statistic means",
  "quote": "Relevant quote if quote slide",
  "quoteAuthor": "Author Name",
  "imageKeyword": "${slideOutline.imageKeyword || 'relevant topic'}"
}

Be SPECIFIC with real facts about "${originalContent}".`
        }]
      });

      const text = response.content[0].text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');
      
      const json = JSON.parse(jsonMatch[0]);
      
      // Add image URL
      if (json.imageKeyword) {
        json.imageUrl = await getUnsplashImage(json.imageKeyword);
      }
      
      return res.status(200).json(json);
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
          x: 0, y: 0, w: '100%', h: 0.05, 
          fill: { color: theme.accent } 
        });

        const hasImage = slideData.imageUrl && 
          ['imageRight', 'imageLeft', 'imageBackground', 'title'].includes(slideData.type);

        switch (slideData.type) {
          case 'title':
            // Title with optional background image
            if (slideData.imageUrl) {
              slide.addImage({
                path: slideData.imageUrl,
                x: 0, y: 0, w: '100%', h: '100%',
                sizing: { type: 'cover' }
              });
              // Dark overlay
              slide.addShape(pptx.shapes.RECTANGLE, {
                x: 0, y: 0, w: '100%', h: '100%',
                fill: { color: '000000', transparency: 50 }
              });
            }
            slide.addText(slideData.title || 'Title', {
              x: 0.8, y: 2, w: 8.4, h: 1.5,
              fontSize: 44, fontFace: 'Arial', color: 'FFFFFF', bold: true,
              align: 'center', valign: 'middle'
            });
            if (slideData.subtitle) {
              slide.addText(slideData.subtitle, {
                x: 0.8, y: 3.5, w: 8.4, h: 0.8,
                fontSize: 22, fontFace: 'Arial', color: 'FFFFFF',
                align: 'center', transparency: 20
              });
            }
            slide.addShape(pptx.shapes.RECTANGLE, { 
              x: 4, y: 4.3, w: 2, h: 0.08, 
              fill: { color: theme.accent } 
            });
            break;

          case 'imageRight':
            // Content on left, image on right
            slide.addText(slideData.title || '', { 
              x: 0.5, y: 0.4, w: 5, h: 0.8, 
              fontSize: 28, fontFace: 'Arial', color: theme.text, bold: true 
            });
            if (slideData.content?.length) {
              const bullets = slideData.content.map(c => ({
                text: c,
                options: { 
                  bullet: { color: theme.accent }, 
                  fontSize: 16, 
                  color: theme.text, 
                  paraSpaceAfter: 14 
                }
              }));
              slide.addText(bullets, { x: 0.5, y: 1.3, w: 5, h: 3.8 });
            }
            if (slideData.imageUrl) {
              // Image container with rounded effect
              slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 5.7, y: 0.5, w: 4.1, h: 4.3,
                fill: { color: theme.secondary }
              });
              slide.addImage({
                path: slideData.imageUrl,
                x: 5.8, y: 0.6, w: 3.9, h: 4.1,
                rounding: true
              });
            }
            break;

          case 'imageLeft':
            // Image on left, content on right
            if (slideData.imageUrl) {
              slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
                x: 0.3, y: 0.5, w: 4.1, h: 4.3,
                fill: { color: theme.secondary }
              });
              slide.addImage({
                path: slideData.imageUrl,
                x: 0.4, y: 0.6, w: 3.9, h: 4.1,
                rounding: true
              });
            }
            slide.addText(slideData.title || '', { 
              x: 4.8, y: 0.4, w: 5, h: 0.8, 
              fontSize: 28, fontFace: 'Arial', color: theme.text, bold: true 
            });
            if (slideData.content?.length) {
              const bullets = slideData.content.map(c => ({
                text: c,
                options: { 
                  bullet: { color: theme.accent }, 
                  fontSize: 16, 
                  color: theme.text, 
                  paraSpaceAfter: 14 
                }
              }));
              slide.addText(bullets, { x: 4.8, y: 1.3, w: 4.8, h: 3.8 });
            }
            break;

          case 'imageBackground':
            // Full background image with text overlay
            if (slideData.imageUrl) {
              slide.addImage({
                path: slideData.imageUrl,
                x: 0, y: 0, w: '100%', h: '100%',
                sizing: { type: 'cover' }
              });
              slide.addShape(pptx.shapes.RECTANGLE, {
                x: 0, y: 0, w: '100%', h: '100%',
                fill: { color: '000000', transparency: 40 }
              });
            }
            slide.addText(slideData.title || '', { 
              x: 0.8, y: 1.5, w: 8.4, h: 1, 
              fontSize: 36, fontFace: 'Arial', color: 'FFFFFF', bold: true,
              align: 'center'
            });
            if (slideData.content?.length) {
              const text = slideData.content.slice(0, 3).join('\n\n');
              slide.addText(text, { 
                x: 1.5, y: 2.8, w: 7, h: 2,
                fontSize: 18, color: 'FFFFFF', align: 'center',
                lineSpacing: 28
              });
            }
            break;

          case 'stats':
            slide.addText(slideData.title, { 
              x: 0.8, y: 0.4, w: 5, h: 0.7, 
              fontSize: 26, fontFace: 'Arial', color: theme.text, bold: true 
            });
            slide.addText(slideData.statValue || '73%', { 
              x: 0.8, y: 1.2, w: 5, h: 1.8, 
              fontSize: 90, fontFace: 'Arial', color: theme.accent, bold: true
            });
            slide.addText(slideData.statLabel || '', { 
              x: 0.8, y: 3, w: 5, h: 0.5, 
              fontSize: 16, fontFace: 'Arial', color: theme.text, transparency: 30
            });
            if (slideData.content?.length) {
              const bullets = slideData.content.slice(0, 3).map(c => ({
                text: c,
                options: { bullet: { color: theme.accent }, fontSize: 14, color: theme.text, paraSpaceAfter: 10 }
              }));
              slide.addText(bullets, { x: 0.8, y: 3.6, w: 5, h: 1.5 });
            }
            if (slideData.imageUrl) {
              slide.addImage({
                path: slideData.imageUrl,
                x: 6, y: 0.8, w: 3.5, h: 3.5,
                rounding: true
              });
            }
            break;

          case 'quote':
            if (slideData.imageUrl) {
              slide.addImage({
                path: slideData.imageUrl,
                x: 0, y: 0, w: '100%', h: '100%',
                sizing: { type: 'cover' }
              });
              slide.addShape(pptx.shapes.RECTANGLE, {
                x: 0, y: 0, w: '100%', h: '100%',
                fill: { color: '000000', transparency: 60 }
              });
            }
            slide.addText('"', { 
              x: 0.5, y: 1, w: 1, h: 1, 
              fontSize: 100, fontFace: 'Georgia', color: theme.accent, transparency: 40
            });
            slide.addText(slideData.quote || slideData.content?.[0] || '', {
              x: 1, y: 1.8, w: 8, h: 2,
              fontSize: 24, fontFace: 'Georgia', color: 'FFFFFF', italic: true, 
              align: 'center', valign: 'middle'
            });
            if (slideData.quoteAuthor) {
              slide.addText(`— ${slideData.quoteAuthor}`, { 
                x: 1, y: 4, w: 8, h: 0.5, 
                fontSize: 14, fontFace: 'Arial', color: theme.accent, align: 'center'
              });
            }
            break;

          case 'twoColumn':
            slide.addText(slideData.title || '', { 
              x: 0.5, y: 0.4, w: 9, h: 0.7, 
              fontSize: 28, fontFace: 'Arial', color: theme.text, bold: true 
            });
            const content = slideData.content || [];
            const mid = Math.ceil(content.length / 2);
            
            // Left card
            slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
              x: 0.4, y: 1.2, w: 4.4, h: 3.8,
              fill: { color: theme.secondary }
            });
            const leftItems = content.slice(0, mid).map(c => ({
              text: c,
              options: { bullet: { color: theme.accent }, fontSize: 15, color: theme.text, paraSpaceAfter: 12 }
            }));
            slide.addText(leftItems, { x: 0.7, y: 1.5, w: 4, h: 3.3 });
            
            // Right card
            slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, {
              x: 5.2, y: 1.2, w: 4.4, h: 3.8,
              fill: { color: theme.secondary }
            });
            const rightItems = content.slice(mid).map(c => ({
              text: c,
              options: { bullet: { color: theme.accent }, fontSize: 15, color: theme.text, paraSpaceAfter: 12 }
            }));
            slide.addText(rightItems, { x: 5.5, y: 1.5, w: 4, h: 3.3 });
            break;

          case 'conclusion':
            slide.addText(slideData.title, { 
              x: 0.5, y: 1.2, w: 9, h: 0.9, 
              fontSize: 36, fontFace: 'Arial', color: theme.text, bold: true, align: 'center'
            });
            if (slideData.content?.length) {
              const items = slideData.content.map(c => ({
                text: '✓  ' + c,
                options: { fontSize: 18, color: theme.text, align: 'center', paraSpaceAfter: 16 }
              }));
              slide.addText(items, { x: 1.5, y: 2.3, w: 7, h: 2 });
            }
            slide.addShape(pptx.shapes.ROUNDED_RECTANGLE, { 
              x: 3.5, y: 4.3, w: 3, h: 0.7, 
              fill: { color: theme.accent } 
            });
            slide.addText('Thank You!', { 
              x: 3.5, y: 4.3, w: 3, h: 0.7, 
              fontSize: 18, fontFace: 'Arial', color: theme.background, bold: true, 
              align: 'center', valign: 'middle'
            });
            break;

          default: // content fallback
            slide.addText(slideData.title || '', { 
              x: 0.5, y: 0.4, w: 9, h: 0.8, 
              fontSize: 28, fontFace: 'Arial', color: theme.text, bold: true 
            });
            if (slideData.content?.length) {
              const bullets = slideData.content.map(c => ({
                text: c,
                options: { 
                  bullet: { color: theme.accent }, 
                  fontSize: 18, 
                  color: theme.text, 
                  paraSpaceAfter: 16 
                }
              }));
              slide.addText(bullets, { x: 0.5, y: 1.3, w: 9, h: 3.8 });
            }
        }

        // Slide number
        slide.addText(String(slideData.id), { 
          x: 9.3, y: 5.1, w: 0.4, h: 0.3, 
          fontSize: 10, color: theme.text, transparency: 50 
        });
      }

      const buffer = await pptx.write({ outputType: 'nodebuffer' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
      res.setHeader('Content-Disposition', `attachment; filename="${title || 'presentation'}.pptx"`);
      return res.send(buffer);
    }

    return res.status(404).json({ error: 'Not found' });

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
};