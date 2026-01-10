// StudySlides Backend - Gamma API White Label Integration v3
// With improved download URL detection and extended polling

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

      // Build request body - IMPORTANT: exportAs must be exactly "pptx" as a string
      const requestBody = {
        inputText,
        textMode,
        format,
        numCards: Math.min(Math.max(numCards, 1), 60),
        cardSplit: 'auto',
        additionalInstructions,
        exportAs: 'pptx', // Must be lowercase string
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

    // Check generation status - with improved download URL detection
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
      
      // Log the FULL response to see all available fields
      console.log('=== FULL GAMMA STATUS RESPONSE ===');
      console.log(JSON.stringify(data, null, 2));
      console.log('=== END RESPONSE ===');
      
      // Extract gamma URL
      const gammaUrl = data.gammaUrl || data.url || data.gamma_url;
      
      // Look for download URL in ALL possible locations
      let downloadUrl = null;
      
      // Check direct fields
      if (data.downloadLink) downloadUrl = data.downloadLink;
      if (data.download_link) downloadUrl = data.download_link;
      if (data.pptxUrl) downloadUrl = data.pptxUrl;
      if (data.pptx_url) downloadUrl = data.pptx_url;
      if (data.exportUrl) downloadUrl = data.exportUrl;
      if (data.export_url) downloadUrl = data.export_url;
      
      // Check nested exports object
      if (data.exports) {
        if (data.exports.pptx) downloadUrl = data.exports.pptx;
        if (data.exports.pptxUrl) downloadUrl = data.exports.pptxUrl;
        if (data.exports.downloadLink) downloadUrl = data.exports.downloadLink;
      }
      
      // Check nested export object (singular)
      if (data.export) {
        if (data.export.pptx) downloadUrl = data.export.pptx;
        if (data.export.url) downloadUrl = data.export.url;
      }
      
      // Check if there's a file or files field
      if (data.file) downloadUrl = data.file;
      if (data.fileUrl) downloadUrl = data.fileUrl;
      if (data.files && data.files.pptx) downloadUrl = data.files.pptx;
      
      // Determine status
      let status = data.status;
      
      // If completed but no download URL, keep as "waiting_for_export"
      if (data.status === 'completed' && !downloadUrl) {
        status = 'waiting_for_export';
      }
      
      // Build response
      const result = {
        status: status,
        generationId: data.generationId,
        gammaUrl: gammaUrl,
        downloadUrl: downloadUrl,
        title: data.title,
        creditsUsed: data.credits?.deducted,
        // Include all keys we found for debugging
        availableKeys: Object.keys(data)
      };
      
      console.log('Returning status:', result);
      
      return res.status(200).json(result);
    }

    // Proxy download endpoint - downloads from Gamma and serves to user
    if (path === '/api/download' && req.method === 'GET') {
      const { url } = req.query;
      
      if (!url) {
        return res.status(400).json({ error: 'URL required' });
      }

      console.log('Proxying download from:', url);

      const response = await fetch(url, {
        headers: {
          'X-API-KEY': GAMMA_API_KEY
        }
      });
      
      if (!response.ok) {
        console.error('Download failed:', response.status, response.statusText);
        throw new Error('Failed to download file');
      }

      const buffer = await response.arrayBuffer();
      const contentType = response.headers.get('content-type') || 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      
      // Extract filename from URL or use default
      let filename = 'presentation.pptx';
      try {
        const urlParts = url.split('/');
        const lastPart = urlParts[urlParts.length - 1];
        if (lastPart && lastPart.includes('.pptx')) {
          filename = decodeURIComponent(lastPart.split('?')[0]);
        }
      } catch (e) {
        console.error('Error extracting filename:', e);
      }
      
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', buffer.byteLength);
      
      return res.send(Buffer.from(buffer));
    }

    // Debug endpoint - make a fresh GET request to check for download URL
    if (path === '/api/debug-status' && req.method === 'GET') {
      const generationId = req.query.id;
      
      if (!generationId) {
        return res.status(400).json({ error: 'Generation ID required' });
      }

      // Make multiple requests with delays to catch the download URL
      const results = [];
      
      for (let i = 0; i < 3; i++) {
        const response = await fetch(`${GAMMA_API_URL}/generations/${generationId}`, {
          headers: { 'X-API-KEY': GAMMA_API_KEY }
        });
        
        const data = await response.json();
        results.push({
          attempt: i + 1,
          timestamp: new Date().toISOString(),
          fullResponse: data
        });
        
        // Wait 2 seconds between requests
        if (i < 2) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
      return res.status(200).json({ results });
    }

    return res.status(404).json({ error: 'Not found' });

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ 
      error: error.message || 'Internal server error'
    });
  }
};