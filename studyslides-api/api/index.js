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
      const response = await fetch(`${GAMMA_API_URL}/themes?limit=50`, {
        headers: { 'X-API-KEY': GAMMA_API_KEY }
      });
      
      if (!response.ok) {
        const err = await response.text();
        console.error('Themes error:', err);
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
        themeId = null,
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

      // Build request body
      const requestBody = {
        inputText,
        textMode,
        format,
        numCards: Math.min(Math.max(numCards, 1), 60),
        cardSplit: 'auto',
        additionalInstructions,
        exportAs: 'pptx', // Always request PPTX export
        textOptions: {
          amount: textOptions.amount || 'medium',
          tone: textOptions.tone || 'professional',
          audience: textOptions.audience || 'general',
          language: textOptions.language || 'en'
        },
        imageOptions: {
          source: imageOptions.source || 'aiGenerated',
          style: imageOptions.style || 'modern, professional'
        },
        cardOptions: {
          dimensions: cardOptions.dimensions || '16x9'
        }
      };

      // Only add themeId if provided
      if (themeId && themeId.trim()) {
        requestBody.themeId = themeId;
      }

      console.log('Request body:', JSON.stringify(requestBody, null, 2));

      // Call Gamma API
      const gammaResponse = await fetch(`${GAMMA_API_URL}/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': GAMMA_API_KEY
        },
        body: JSON.stringify(requestBody)
      });

      const responseText = await gammaResponse.text();
      console.log('Gamma response:', responseText);

      if (!gammaResponse.ok) {
        let errorData;
        try {
          errorData = JSON.parse(responseText);
        } catch {
          errorData = { message: responseText };
        }
        console.error('Gamma API error:', errorData);
        throw new Error(errorData.message || errorData.error || 'Failed to start generation');
      }

      const generationData = JSON.parse(responseText);
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
        const err = await response.text();
        console.error('Status check error:', err);
        throw new Error('Failed to check status');
      }

      const data = await response.json();
      console.log('Full status response:', JSON.stringify(data, null, 2));
      
      // Extract URLs from various possible response formats
      const gammaUrl = data.url || data.gammaUrl || data.gamma_url;
      
      // Check all possible locations for download URLs
      let pptxUrl = data.pptxUrl || data.pptx_url || data.downloadLink || data.download_link;
      let pdfUrl = data.pdfUrl || data.pdf_url;
      
      // Check exports object
      if (data.exports) {
        pptxUrl = pptxUrl || data.exports.pptx || data.exports.pptxUrl;
        pdfUrl = pdfUrl || data.exports.pdf || data.exports.pdfUrl;
      }
      
      // Check if downloadLink contains pptx
      if (data.downloadLink && data.downloadLink.includes('.pptx')) {
        pptxUrl = data.downloadLink;
      }
      if (data.downloadLink && data.downloadLink.includes('.pdf')) {
        pdfUrl = data.downloadLink;
      }
      
      // If status is completed but no download URLs yet, mark as "processing_export"
      let status = data.status;
      if (data.status === 'completed' && !pptxUrl && !pdfUrl) {
        // Keep polling - exports might still be generating
        status = 'processing_export';
      }
      
      return res.status(200).json({
        status: status,
        generationId: data.generationId,
        url: gammaUrl,
        pptxUrl: pptxUrl || null,
        pdfUrl: pdfUrl || null,
        title: data.title,
        creditsUsed: data.credits?.deducted,
        raw: data // Include raw response for debugging
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

    return res.status(404).json({ error: 'Not found' });

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ 
      error: error.message || 'Internal server error'
    });
  }
};