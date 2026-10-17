
const { createClient } = require("@supabase/supabase-js");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({
      error: "Gunakan metode POST."
    });
  }

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : "";

  if (!token) {
    return res.status(401).json({
      error: "Silakan login terlebih dahulu."
    });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return res.status(500).json({
      error: "Konfigurasi backend belum lengkap."
    });
  }

  const supabase = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  try {
    // Verifikasi token ke server Supabase, jangan percaya user_id dari browser.
    const { data: userData, error: authError } =
      await supabase.auth.getUser(token);

    if (authError || !userData.user) {
      return res.status(401).json({
        error: "Sesi login tidak valid."
      });
    }

    const body = req.body || {};
    const serviceId = body.service_id;
    const targetUrl = body.target_url;
    const quantity = body.quantity;

    if (
      typeof serviceId !== "string" ||
      typeof targetUrl !== "string" ||
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      quantity > 1000000
    ) {
      return res.status(400).json({
        error: "Data order tidak valid."
      });
    }

    // p_user_id berasal dari token yang sudah diverifikasi.
    // Harga dan saldo dihitung serta diperiksa di database.
    const { data, error } = await supabase.rpc(
      "create_paid_order",
      {
        p_user_id: userData.user.id,
        p_service_id: serviceId,
        p_target_url: targetUrl,
        p_quantity: quantity
      }
    );

    if (error) {
      const message = error.message || "";

      if (message.includes("INSUFFICIENT_BALANCE")) {
        return res.status(400).json({
          error: "Saldo tidak cukup."
        });
      }

      if (message.includes("SERVICE_NOT_AVAILABLE")) {
        return res.status(400).json({
          error: "Layanan tidak tersedia."
        });
      }

      if (
        message.includes("INVALID_QUANTITY") ||
        message.includes("INVALID_TARGET_URL")
      ) {
        return res.status(400).json({
          error: "Jumlah atau link target tidak valid."
        });
      }

      console.error("Order RPC failed:", message);

      return res.status(500).json({
        error: "Order gagal diproses."
      });
    }

    return res.status(201).json(data);
  } catch (err) {
    console.error("Order API error:", err);

    return res.status(500).json({
      error: "Terjadi kesalahan pada server."
    });
  }
};
