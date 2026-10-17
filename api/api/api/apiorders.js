
const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const publicKey =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY;

const secretKey =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const authClient =
  supabaseUrl && publicKey
    ? createClient(supabaseUrl, publicKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      })
    : null;

const adminClient =
  supabaseUrl && secretKey
    ? createClient(supabaseUrl, secretKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      })
    : null;

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "Gunakan metode POST"
    });
  }

  if (!authClient || !adminClient) {
    return res.status(500).json({
      error: "Konfigurasi backend belum lengkap"
    });
  }

  try {
    const authorization = req.headers.authorization || "";
    const match = authorization.match(/^Bearer\s+(\S+)$/i);

    if (!match) {
      return res.status(401).json({
        error: "Token login diperlukan"
      });
    }

    const { data: authData, error: authError } =
      await authClient.auth.getUser(match[1]);

    if (authError || !authData.user) {
      return res.status(401).json({
        error: "Sesi login tidak valid"
      });
    }

    const body = req.body || {};
    const serviceId = body.service_id;
    const targetUrl = body.target_url;
    const quantity = body.quantity;

    if (
      typeof serviceId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(serviceId) ||
      typeof targetUrl !== "string" ||
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      quantity > 1000000
    ) {
      return res.status(400).json({
        error: "Data order tidak valid"
      });
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(targetUrl);
    } catch {
      return res.status(400).json({
        error: "URL target tidak valid"
      });
    }

    if (
      parsedUrl.protocol !== "https:" ||
      parsedUrl.username ||
      parsedUrl.password
    ) {
      return res.status(400).json({
        error: "Target harus menggunakan HTTPS"
      });
    }

    const { data, error } = await adminClient.rpc(
      "create_paid_order",
      {
        p_user_id: authData.user.id,
        p_service_id: serviceId,
        p_target_url: parsedUrl.toString(),
        p_quantity: quantity
      }
    );

    if (error) {
      const message = error.message || "";

      if (message.includes("Saldo tidak mencukupi")) {
        return res.status(400).json({
          error: "Saldo tidak mencukupi"
        });
      }

      if (
        message.includes("Layanan tidak tersedia") ||
        message.includes("Input order tidak valid") ||
        message.includes("Target harus")
      ) {
        return res.status(400).json({
          error: message
        });
      }

      console.error("Order RPC failed:", message);

      return res.status(500).json({
        error: "Order gagal diproses"
      });
    }

    return res.status(201).json(data);
  } catch (error) {
    console.error("Order endpoint failed:", error.message);

    return res.status(500).json({
      error: "Terjadi kesalahan pada server"
    });
  }
};
          
