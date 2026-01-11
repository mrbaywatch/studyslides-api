// StudySlides Backend - With Stripe Payments
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

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
        gammaConfigured: !!GAMMA_API_KEY,
        stripeConfigured: !!process.env.STRIPE_SECRET_KEY
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

    // Create Stripe Checkout Session
    if (path === '/api/create-checkout' && req.method === 'POST') {
      const { numSlides, userEmail, prompt, theme, language, format } = req.body;
      
      if (!numSlides || numSlides < 1) {
        return res.status(400).json({ error: 'Number of slides required' });
      }

      const pricePerSlide = 2000; // 20 NOK in øre
      const totalAmount = numSlides * pricePerSlide;

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [{
          price_data: {
            currency: 'nok',
            product_data: {
              name: `StudySlides - ${numSlides} Slide Presentation`,
              description: `Generate a ${numSlides}-slide AI presentation`,
            },
            unit_amount: totalAmount,
          },
          quantity: 1,
        }],
        mode: 'payment',
        success_url: `${req.headers.origin || 'https://studyslides.vercel.app'}?success=true&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${req.headers.origin || 'https://studyslides.vercel.app'}?canceled=true`,
        customer_email: userEmail || undefined,
        metadata: {
          numSlides: numSlides.toString(),
          prompt: prompt ? prompt.substring(0, 500) : '',
          theme: theme || '',
          language: language || 'en',
          format: format || 'presentation'
        },
      });

      return res.status(200).json({ 
        sessionId: session.id,
        url: session.url 
      });
    }

    // Verify payment and get session details
    if (path === '/api/verify-payment' && req.method === 'GET') {
      const sessionId = req.query.session_id;
      
      if (!sessionId) {
        return res.status(400).json({ error: 'Session ID required' });
      }

      try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        
        if (session.payment_status === 'paid') {
          return res.status(200).json({
            paid: true,
            numSlides: parseInt(session.metadata.numSlides),
            prompt: session.metadata.prompt,
            theme: session.metadata.theme,
            language: session.metadata.language,
            format: session.metadata.format,
            customerEmail: session.customer_email,
            amountPaid: session.amount_total,
          });
        } else {
          return res.status(200).json({ paid: false });
        }
      } catch (e) {
        console.error('Session retrieval error:', e);
        return res.status(400).json({ error: 'Invalid session ID' });
      }
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
        cardOptions = {},
        sessionId = null
      } = req.body;

      if (!inputText) {
        return res.status(400).json({ error: 'inputText is required' });
      }

      // Verify payment if sessionId provided
      if (sessionId) {
        try {
          const session = await stripe.checkout.sessions.retrieve(sessionId);
          if (session.payment_status !== 'paid') {
            return res.status(403).json({ error: 'Payment not completed' });
          }
          console.log('Payment verified for session:', sessionId);
        } catch (e) {
          console.error('Payment verification failed:', e);
          return res.status(403).json({ error: 'Invalid payment session' });
        }
      }

      console.log('Generating presentation:', inputText.substring(0, 100));

      const requestBody = {
        inputText,
        textMode,
        format,
        numCards: Math.min(Math.max(numCards, 1), 60),
        cardSplit: 'auto',
        additionalInstructions,
        exportAs: 'pptx',
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

      if (themeId && themeId.trim()) {
        requestBody.themeId = themeId;
      }

      console.log('Request body:', JSON.stringify(requestBody, null, 2));

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
      
      console.log('=== FULL GAMMA STATUS RESPONSE ===');
      console.log(JSON.stringify(data, null, 2));
      console.log('=== END RESPONSE ===');
      
      const gammaUrl = data.gammaUrl || data.url || data.gamma_url;
      
      let downloadUrl = null;
      
      if (data.exportUrl) downloadUrl = data.exportUrl;
      if (data.export_url) downloadUrl = data.export_url;
      if (data.downloadLink) downloadUrl = data.downloadLink;
      if (data.download_link) downloadUrl = data.download_link;
      if (data.pptxUrl) downloadUrl = data.pptxUrl;
      if (data.pptx_url) downloadUrl = data.pptx_url;
      
      if (data.exports) {
        if (data.exports.pptx) downloadUrl = data.exports.pptx;
        if (data.exports.pptxUrl) downloadUrl = data.exports.pptxUrl;
        if (data.exports.downloadLink) downloadUrl = data.exports.downloadLink;
      }
      
      if (data.export) {
        if (data.export.pptx) downloadUrl = data.export.pptx;
        if (data.export.url) downloadUrl = data.export.url;
      }
      
      if (data.file) downloadUrl = data.file;
      if (data.fileUrl) downloadUrl = data.fileUrl;
      if (data.files && data.files.pptx) downloadUrl = data.files.pptx;
      
      let status = data.status;
      
      if (data.status === 'completed' && !downloadUrl) {
        status = 'waiting_for_export';
      }
      
      const result = {
        status: status,
        generationId: data.generationId,
        gammaUrl: gammaUrl,
        downloadUrl: downloadUrl,
        title: data.title,
        creditsUsed: data.credits?.deducted,
        availableKeys: Object.keys(data)
      };
      
      console.log('Returning status:', result);
      
      return res.status(200).json(result);
    }

    // Proxy download endpoint
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

    return res.status(404).json({ error: 'Not found' });

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ 
      error: error.message || 'Internal server error'
    });
  }
};