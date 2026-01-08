// StudySlides Backend - Gamma API White Label Integration

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const GAMMA_API_KEY = process.env.GAMMA_API_KEY;
  const GAMMA_API_URL = 'https://public-api.gamma.app/v1.0';

  const path = req.url.split('?')[0];

  try {
    // Health check
    if (path === '/api/health') {
      return res.status(200).json({ 
        status: 'ok', 
        time: new Date().toISOString(),
        gammaConfigured: !!GAMMA_API_KEY
      });
    }

    // Get available themes from Gamma
    if (path === '/api/themes' && req.method === 'GET') {
      const response = await fetch(`${GAMMA_API_URL}/themes`, {
        headers: { 'X-API-KEY': GAMMA_API_KEY }
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch themes');
      }
      
      const data = await response.json();
      return res.status(200).json(data);
    }

    // Generate presentation (main endpoint)
    if (path === '/api/generate' && req.method === 'POST') {
      const { 
        inputText, 
        textMode = 'generate',
        format = 'presentation',
        themeId = 'Starter',
        numCards = 8,
        additionalInstructions = '',
        exportAs = 'pptx',
        textOptions = {},
        imageOptions = {},
        cardOptions = {}
      } = req.body;

      if (!inputText) {
        return res.status(400).json({ error: 'inputText is required' });
      }

      console.log('Generating presentation:', inputText.substring(0, 100));

      // Call Gamma API
      const gammaResponse = await fetch(`${GAMMA_API_URL}/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': GAMMA_API_KEY
        },
        body: JSON.stringify({
          inputText,
          textMode,
          format,
          themeId,
          numCards: Math.min(Math.max(numCards, 1), 60),
          cardSplit: 'auto',
          additionalInstructions,
          exportAs,
          textOptions: {
            amount: textOptions.amount || 'medium',
            tone: textOptions.tone || 'professional',
            audience: textOptions.audience || 'general',
            language: textOptions.language || 'en',
            ...textOptions
          },
          imageOptions: {
            source: imageOptions.source || 'aiGenerated',
            model: imageOptions.model || 'flux-1-pro',
            style: imageOptions.style || 'modern, professional',
            ...imageOptions
          },
          cardOptions: {
            dimensions: cardOptions.dimensions || '16x9',
            ...cardOptions
          }
        })
      });

      if (!gammaResponse.ok) {
        const errorData = await gammaResponse.json().catch(() => ({}));
        console.error('Gamma API error:', errorData);
        throw new Error(errorData.message || 'Failed to start generation');
      }

      const generationData = await gammaResponse.json();
      console.log('Generation started:', generationData.generationId);

      return res.status(200).json({
        generationId: generationData.generationId,
        status: 'pending',
        message: 'Generation started'
      });
    }

    // Check generation status
    if (path === '/api/status' && req.method === 'GET') {
      const generationId = req.query.id;
      
      if (!generationId) {
        return res.status(400).json({ error: 'Generation ID required' });
      }

      const response = await fetch(`${GAMMA_API_URL}/generations/${generationId}`, {
        headers: { 'X-API-KEY': GAMMA_API_KEY }
      });

      if (!response.ok) {
        throw new Error('Failed to check status');
      }

      const data = await response.json();
      
      return res.status(200).json({
        status: data.status,
        generationId: data.generationId,
        url: data.url,
        pptxUrl: data.pptxUrl,
        pdfUrl: data.pdfUrl,
        title: data.title,
        creditsUsed: data.creditsUsed
      });
    }

    // Proxy download (to hide Gamma URLs from users)
    if (path === '/api/download' && req.method === 'GET') {
      const { url, filename = 'presentation' } = req.query;
      
      if (!url) {
        return res.status(400).json({ error: 'URL required' });
      }

      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error('Failed to download file');
      }

      const buffer = await response.arrayBuffer();
      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      const ext = contentType.includes('pdf') ? 'pdf' : 'pptx';
      
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.${ext}"`);
      return res.send(Buffer.from(buffer));
    }

    // Import from URL
    if (path === '/api/import-url' && req.method === 'POST') {
      const { 
        url, 
        themeId = 'Starter',
        numCards = 8,
        additionalInstructions = '',
        exportAs = 'pptx'
      } = req.body;

      if (!url) {
        return res.status(400).json({ error: 'URL is required' });
      }

      // Fetch content from URL and use as input
      const gammaResponse = await fetch(`${GAMMA_API_URL}/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': GAMMA_API_KEY
        },
        body: JSON.stringify({
          inputText: `Create a presentation based on this URL: ${url}`,
          textMode: 'generate',
          format: 'presentation',
          themeId,
          numCards,
          additionalInstructions: `Import and transform content from: ${url}. ${additionalInstructions}`,
          exportAs,
          imageOptions: {
            source: 'aiGenerated',
            style: 'modern, professional'
          },
          cardOptions: {
            dimensions: '16x9'
          }
        })
      });

      if (!gammaResponse.ok) {
        const errorData = await gammaResponse.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to import from URL');
      }

      const data = await gammaResponse.json();
      return res.status(200).json({
        generationId: data.generationId,
        status: 'pending'
      });
    }

    // Get credit balance (useful for showing users remaining generations)
    if (path === '/api/credits' && req.method === 'GET') {
      // Note: Gamma doesn't have a direct credits endpoint
      // You'd need to track this yourself or check via their dashboard
      return res.status(200).json({
        message: 'Check Gamma dashboard for credit balance',
        estimatedCost: 40 // credits per generation
      });
    }

    return res.status(404).json({ error: 'Not found' });

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ 
      error: error.message || 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};