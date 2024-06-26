const express = require('express');
const Product = require('../models/Product');
const authMiddleware = require('../middleware/auth');
const router = express.Router();

// Get all products
router.get('/', async (req, res) => {
    try {
        const products = await Product.find();
        res.json(products);
    } catch (error) {
        res.status(500).send('Error getting products');
    }
});

// Add new product
router.post('/', authMiddleware, async (req, res) => {
    const { name, description, price, image } = req.body;
    try {
        const product = new Product({ name, description, price, image, user: req.user.id });
        await product.save();
        res.status(201).send('Product added');
    } catch (error) {
        res.status(500).send('Error adding product');
    }
});

// Update product
router.put('/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { name, description, price, image } = req.body;
    try {
        const product = await Product.findById(id);
        if (!product) return res.status(404).send('Product not found');

        product.name = name;
        product.description = description;
        product.price = price;
        product.image = image;

        await product.save();
        res.send('Product updated');
    } catch (error) {
        res.status(500).send('Error updating product');
    }
});

// Delete product
router.delete('/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    try {
        const product = await Product.findById(id);
        if (!product) return res.status(404).send('Product not found');
        if (product.user.toString() !== req.user.id) return res.status(401).send('User not authorized');
        
        await product.remove();
        res.send('Product removed');
    } catch (error) {
        res.status(500).send('Error deleting product');
    }
});

module.exports = router;

