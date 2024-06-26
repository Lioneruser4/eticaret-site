import React, { useState, useEffect } from 'react';
import { useHistory, useParams } from 'react-router-dom';

const ProductForm = () => {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [price, setPrice] = useState('');
    const [image, setImage] = useState('');
    const history = useHistory();
    const { id } = useParams();

    useEffect(() => {
        if (id) {
            const fetchProduct = async () => {
                try {
                    const response = await fetch(`/api/products/${id}`);
                    if (response.ok) {
                        const data = await response.json();
                        setName(data.name);
                        setDescription(data.description);
                        setPrice(data.price);
                        setImage(data.image);
                    } else {
                        console.error('Failed to fetch product');
                    }
                } catch (error) {
                    console.error('Fetch error:', error);
                }
            };
            fetchProduct();
        }
    }, [id]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        const productData = { name, description, price, image };

        try {
            let response;
            if (id) {
                response = await fetch(`/api/products/${id}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(productData)
                });
            } else {
                response = await fetch('/api/products', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(productData)
                });
            }
            if (response.ok) {
                history.push('/');
            } else {
                alert('Operation failed');
            }
        } catch (error) {
            console.error('Operation error:', error);
            alert('Operation failed');
        }
    };

    return (
        <div className="form-group">
            <h2>{id ? 'Edit Product' : 'Add Product'}</h2>
            <form onSubmit={handleSubmit}>
                <input type="text" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required />
                <textarea placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} required />
                <input type="number" placeholder="Price" value={price} onChange={(e) => setPrice(e.target.value)} required />
                <input type="text" placeholder="Image URL" value={image} onChange={(e) => setImage(e.target.value)} required />
                <button type="submit">{id ? 'Update' : 'Add'}</button>
            </form>
        </div>
    );
};

export default ProductForm;

