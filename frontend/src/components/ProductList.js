import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

const ProductList = () => {
    const [products, setProducts] = useState([]);

    useEffect(() => {
        const fetchProducts = async () => {
            try {
                const response = await fetch('/api/products');
                if (response.ok) {
                    const data = await response.json();
                    setProducts(data);
                } else {
                    console.error('Failed to fetch products');
                }
            } catch (error) {
                console.error('Fetch error:', error);
            }
        };
        fetchProducts();
    }, []);

    return (
        <div>
            <h2>Product List</h2>
            <Link to="/add-product">Add Product</Link>
            {products.map(product => (
                <div key={product._id}>
                    <h3>{product.name}</h3>
                    <p>{product.description}</p>
                    <p>${product.price}</p>
                    <img src={product.image} alt={product.name} />
                    <Link to={`/edit-product/${product._id}`}>Edit</Link>
                </div>
            ))}
        </div>
    );
};

export default ProductList;

